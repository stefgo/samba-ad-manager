import { Resolver, lookup } from "dns/promises";
import net from "net";
import { DnsServerHealthSchema, WS_EVENTS, highestSerial, type DcHealth, type DnsServerHealth } from "@sadm/shared";
import { logger } from "../core/logger.js";
import { probeZone } from "../dc/probes/dns.js";
import { DnsServerHealthRepository } from "../repositories/DnsServerHealthRepository.js";
import { DashboardHub } from "./DashboardHub.js";
import { nameServersToAsk, referenceSerials, trackOutOfSync, type ZoneAnswer } from "./dnsServerTracker.js";

/** How long a name server may take to answer one question. */
const PROBE_TIMEOUT_MS = 4000;

/**
 * The name servers of the domain that are no domain controllers: secondaries that transfer
 * a zone from one. Asks each of them for the zones it is responsible for, keeps the answers
 * and tells the dashboards.
 *
 * Which servers those are is not configured: a zone's NS records list them, and the domain
 * controllers' measurements carry those records. `health.dnsServers` adds the ones no zone
 * lists.
 */
export class DnsServerHealthService {
    private static listeners: (() => void)[] = [];

    static onUpdate(listener: () => void): void {
        this.listeners.push(listener);
    }

    /** Every name server as it was last asked. */
    static getAll(): DnsServerHealth[] {
        return DnsServerHealthRepository.findAll().flatMap((row) => {
            try {
                const parsed = DnsServerHealthSchema.safeParse(JSON.parse(row.health));
                if (parsed.success) return [parsed.data];
            } catch {
                // Falls through to the warning.
            }
            logger.warn({ server: row.name }, "A stored name server record could not be read");
            return [];
        });
    }

    /**
     * Where a name server is. Asked of this server's own resolver first, and of the domain
     * controllers' DNS servers where that does not know the name: a secondary's name is in
     * the zone it serves, and this server need not resolve through the domain.
     */
    private static async resolve(name: string, dcAddresses: readonly string[]): Promise<string | null> {
        if (net.isIP(name)) return name;
        try {
            return (await lookup(name)).address;
        } catch {
            // Not known here; the domain is asked next.
        }
        if (dcAddresses.length === 0) return null;
        const resolver = new Resolver({ timeout: PROBE_TIMEOUT_MS, tries: 1 });
        try {
            resolver.setServers([...dcAddresses]);
            const found = await resolver.resolve4(name).catch(() => resolver.resolve6(name));
            return found[0] ?? null;
        } catch {
            return null;
        } finally {
            resolver.cancel();
        }
    }

    /**
     * Asks every name server there is to ask, from what the domain controllers were last
     * measured to serve. `dcAddresses` are where their DNS servers are.
     */
    static async measure(
        controllers: readonly DcHealth[],
        dcHostNames: readonly (string | null | undefined)[],
        dcAddresses: readonly string[],
        configured: readonly string[],
    ): Promise<void> {
        const measured = controllers.flatMap((health) => (health.dns ? [health.dns] : []));
        // Without a single domain controller that could say which zones there are, nothing is known -- and nothing is forgotten.
        if (measured.length === 0) return;

        const references = referenceSerials(measured, highestSerial);
        const toAsk = nameServersToAsk(measured.flatMap((dns) => dns.zones), dcHostNames, configured);
        const before = new Map(this.getAll().map((server) => [server.name, server]));

        const servers = await Promise.all(
            toAsk.map(async ({ name, source, zones }): Promise<DnsServerHealth> => {
                const collectedAt = new Date().toISOString();
                const previous = before.get(name) ?? null;
                const address = await this.resolve(name, dcAddresses);
                if (!address) {
                    return { name, address: null, source, collectedAt, ok: false, detail: "the name does not resolve", zones: [] };
                }

                const probes = await Promise.all(zones.map(async (zone) => ({ zone, probe: await probeZone(address, zone, PROBE_TIMEOUT_MS) })));
                const answered = probes.some(({ probe }) => probe.answered);
                if (!answered) {
                    return { name, address, source, collectedAt, ok: false, detail: probes[0]?.probe.detail ?? null, zones: [] };
                }

                // A server from the configuration is asked about every zone and kept for the
                // ones it holds -- and for one it held when it was last asked, or a zone that
                // has expired there would just disappear.
                const held = new Set(previous?.zones.map((zone) => zone.zone.toLowerCase()));
                const answers: ZoneAnswer[] = probes
                    .filter(({ zone, probe }) => source === "ns" || probe.ok || held.has(zone))
                    .map(({ zone, probe }) => ({
                        zone,
                        ok: probe.ok,
                        detail: probe.detail ?? null,
                        serial: probe.serial ?? null,
                        refresh: probe.refresh ?? null,
                        retry: probe.retry ?? null,
                    }));
                return {
                    name,
                    address,
                    source,
                    collectedAt,
                    ok: true,
                    detail: null,
                    zones: trackOutOfSync(previous, answers, references, collectedAt),
                };
            }),
        );

        DnsServerHealthRepository.replaceAll(
            servers.map((server) => ({ name: server.name, health: JSON.stringify(server), measured_at: server.collectedAt })),
        );
        DashboardHub.broadcast({ type: WS_EVENTS.DNS_SERVERS_UPDATE, payload: servers });
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                logger.warn({ err }, "A listener failed on a change of the name servers' health");
            }
        }
    }
}
