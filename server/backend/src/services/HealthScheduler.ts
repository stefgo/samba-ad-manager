import { lookup } from "dns/promises";
import net from "net";
import type { DcDomainView, DirectoryDc } from "@sadm/shared";
import { logger } from "../core/logger.js";
import { appConfig, directoryConfig } from "../config/AppConfig.js";
import { DcConnections, dcHost } from "../dc/DcConnections.js";
import { measureDc, readDomainView, type SlowParts } from "../dc/measure.js";
import { DomainControllerRepository, type DomainControllerRow } from "../repositories/DomainControllerRepository.js";
import { DcHealthService } from "./DcHealthService.js";
import { DnsServerHealthService } from "./DnsServerHealthService.js";
import { DomainControllerService } from "./DomainControllerService.js";

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Measures every domain controller on a timer, and keeps the list of them in line with the
 * directory.
 *
 * A round measures all of them at once and stores each measurement. What the ones that
 * answered say about who the domain controllers are is then what the list is brought in
 * line with -- so a new domain controller is measured from the round after it joined, with
 * nobody adding it here. Before any is known, and when none answers, the domain is asked at
 * the addresses in `directory.urls`.
 */
export class HealthScheduler {
    private static timer: NodeJS.Timeout | null = null;
    private static running: Promise<void> | null = null;
    /** The domain's DNS name, as last read: what DNS and Kerberos are asked about. */
    private static domainDnsName: string | null = null;
    /** Replication and the counts are read less often than the rest, and carried over in between. */
    private static slow = new Map<string, { at: number; parts: SlowParts }>();
    /** What the log last said about asking the seed addresses, so it says it once. */
    private static lastSeedError: string | null = null;
    /** When the name servers that are no domain controllers were last asked. As often as the slow parts. */
    private static nameServersAt = 0;

    static start(): void {
        if (this.timer) return;
        if (!DcConnections.isConfigured()) {
            logger.warn(
                "The directory is not configured: directory.urls, directory.bindDn and SADM_LDAP_PASSWORD are needed to " +
                    "find and measure the domain controllers. Nothing is measured.",
            );
            return;
        }
        const loop = async () => {
            await this.round();
            this.timer = setTimeout(loop, appConfig.health.interval * 1000);
            this.timer.unref?.();
        };
        void loop();
    }

    static stop(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    /** One round. A round that is still under way is joined, not doubled. */
    static round(): Promise<void> {
        this.running ??= this.measureAll()
            .catch((err) => logger.warn({ err }, "A round of measurements failed"))
            .finally(() => {
                this.running = null;
            });
        return this.running;
    }

    /** `readSlowNow` reads replication and the counts whatever their age, and asks the name servers too. */
    private static async measureAll(readSlowNow = false): Promise<void> {
        let rows = DomainControllerRepository.findAll();
        if (rows.length === 0) {
            await this.askSeeds();
            rows = DomainControllerRepository.findAll();
        }
        const views = (await Promise.all(rows.map((row) => this.measure(row, readSlowNow)))).filter((view) => view !== null);
        if (views.length > 0) {
            this.sync(views);
        } else if (rows.length > 0) {
            // None of the known ones answered. The domain may have new ones this server has never heard of.
            await this.askSeeds();
        }
        await this.askNameServers(readSlowNow);
    }

    /**
     * Asks the name servers that are no domain controllers, from what the domain controllers
     * were just measured to serve. After them and not with them: which servers there are,
     * and what serial number they should have, is what the domain controllers say.
     */
    private static async askNameServers(now: boolean): Promise<void> {
        if (!now && Date.now() - this.nameServersAt < appConfig.health.replicationInterval * 1000) return;
        this.nameServersAt = Date.now();
        const rows = DomainControllerRepository.findAll();
        const answering = DcHealthService.getAll().filter((health) => health.dns);
        const addresses = answering.flatMap((health) => {
            const row = rows.find((candidate) => candidate.id === health.dcId);
            const host = row && dcHost({ id: row.id, dnsHostName: row.dns_host_name, address: row.address });
            return host ? [host] : [];
        });
        try {
            await DnsServerHealthService.measure(
                answering,
                rows.map((row) => row.dns_host_name),
                await this.addressesOf(addresses),
                appConfig.health.dnsServers,
            );
        } catch (err) {
            logger.warn({ err }, "The name servers could not be asked");
        }
    }

    /** The IP addresses of some hosts; one that does not resolve is left out. */
    private static async addressesOf(hosts: readonly string[]): Promise<string[]> {
        const found = await Promise.all(
            hosts.map(async (host) => {
                if (net.isIP(host)) return host;
                try {
                    return (await lookup(host)).address;
                } catch {
                    return null;
                }
            }),
        );
        return found.filter((address): address is string => address !== null);
    }

    /** Measures one domain controller and stores the result. Its view of the domain, where it gave one. */
    private static async measure(row: DomainControllerRow, readSlowNow: boolean): Promise<DcDomainView | null> {
        const kept = this.slow.get(row.id);
        const fresh = !readSlowNow && kept && Date.now() - kept.at < appConfig.health.replicationInterval * 1000;
        const { measurement, slow } = await measureDc({
            dc: { id: row.id, name: row.name, dnsHostName: row.dns_host_name, address: row.address },
            domainDnsName: this.domainDnsName,
            slow: fresh ? kept.parts : null,
        });
        if (slow && !fresh) this.slow.set(row.id, { at: Date.now(), parts: slow });
        if (!slow) this.slow.delete(row.id);
        if (measurement.domain) this.domainDnsName = measurement.domain.dnsName;
        DcHealthService.storeMeasurement(row.id, measurement);
        return measurement.domain ?? null;
    }

    /**
     * The list every domain controller that answered agrees on -- or rather, the union of
     * what they list: one that has not replicated a removal yet still names the one that
     * went, and removing it here a round late costs less than removing one that is there.
     */
    private static sync(views: readonly DcDomainView[]): void {
        const listed = new Map<string, DirectoryDc>();
        for (const view of views) {
            for (const dc of view.controllers) listed.set(dc.id.toLowerCase(), dc);
        }
        DomainControllerService.sync([...listed.values()]);
        for (const id of this.slow.keys()) {
            if (!listed.has(id)) this.slow.delete(id);
        }
    }

    /** Asks the domain at `directory.urls` who its domain controllers are: the first that answers decides. */
    private static async askSeeds(): Promise<void> {
        const errors: string[] = [];
        for (const url of directoryConfig.urls) {
            const ldap = DcConnections.seed(url);
            try {
                const root = await ldap.read("", ["defaultNamingContext", "configurationNamingContext", "schemaNamingContext", "rootDomainNamingContext", "domainFunctionality", "forestFunctionality"]);
                if (!root) throw new Error("the directory returned no rootDSE");
                const view = await readDomainView(ldap, root);
                this.domainDnsName = view.dnsName;
                if (this.lastSeedError) logger.info({ url }, "The directory answers again");
                this.lastSeedError = null;
                DomainControllerService.sync(view.controllers);
                return;
            } catch (err) {
                errors.push(`${url}: ${message(err)}`);
                await ldap.reset();
            }
        }
        const summary = errors.join("; ");
        // Once when it breaks, not once a minute while it stays broken.
        if (summary !== this.lastSeedError) {
            logger.warn(`The directory could not be asked for its domain controllers -- ${summary}`);
            this.lastSeedError = summary;
        }
    }

    /** Measures one domain controller now, replication included. False when there is no such domain controller. */
    static async measureNow(dcId: string): Promise<boolean> {
        const row = DomainControllerRepository.findById(dcId);
        if (!row) return false;
        const view = await this.measure(row, true);
        if (view) this.sync([view, ...this.otherViews(dcId)]);
        // "Measure now" is asked for to see a change: the name servers are part of what may have changed.
        await this.askNameServers(true);
        return true;
    }

    /**
     * Measures every domain controller now, replication included: one round, so the list is
     * brought in line once and the name servers are asked once. A round under way is waited
     * for first, or the two would write over each other.
     */
    static async measureAllNow(): Promise<void> {
        if (!DcConnections.isConfigured()) return;
        await this.running;
        await this.measureAll(true);
    }

    /** The views of the others as last measured, so that syncing after one measurement does not drop what only they list. */
    private static otherViews(dcId: string): DcDomainView[] {
        return DcHealthService.getAll().flatMap((health) => (health.dcId !== dcId && health.domain ? [health.domain] : []));
    }
}
