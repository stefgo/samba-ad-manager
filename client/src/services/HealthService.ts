import net from "net";
import {
    DC_PORTS,
    DcDbcheckSchema,
    FSMO_ROLES,
    dnsNameOfDn,
    parseServerDn,
    type DcContainer,
    type DcDbcheck,
    type DcDomainView,
    type DcHealthReport,
    type DcIdentity,
    type DcPort,
    type DcProcess,
    type DcReplication,
    type DirectoryDc,
    type FsmoRole,
} from "@sadm/shared";
import { logger } from "@sadm/shared/node";
import { config } from "../core/Config.js";
import { readJsonFile, writeJsonFile } from "../core/DataStore.js";
import { DockerService } from "./DockerService.js";
import { LdapService, attr } from "./LdapService.js";
import { runSambaHelper } from "./SambaHelper.js";

/** The last database check, kept on disk: it runs once a day and a restart must not forget it. */
const DBCHECK_FILE = "dbcheck-last.json";

/**
 * A measurement goes to the server when it differs from the last one sent, or after this
 * long anyway -- so the server can tell an agent with nothing new from one that stopped
 * measuring.
 */
const RESEND_AFTER_MS = 5 * 60_000;

/** How long a port may take to accept a connection on what is the same host or network. */
const PORT_TIMEOUT_MS = 2000;

type Listener = (report: DcHealthReport) => void;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const bool = (value: string | null): boolean | null => (value === null ? null : value.toUpperCase() === "TRUE");

const int = (value: string | null): number | null => {
    if (value === null) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Measures the domain controller this agent stands next to -- on a timer, on every new
 * connection to the server, and when the server asks.
 *
 * Each part is read from the source that has it in structured form: the container from the
 * Docker API, who the domain controller is and how it sees its domain from LDAP, replication
 * and the service processes from Samba's own modules through the helper. A part that cannot
 * be read is left out and named in `errors`; the rest is still sent. That is the point of
 * measuring from outside: a domain controller whose directory no longer answers is exactly
 * the one that has to be reported.
 */
export class HealthService {
    private static current: DcHealthReport | null = null;
    private static lastSent: { at: number; signature: string } | null = null;
    private static inFlight: Promise<DcHealthReport> | null = null;
    private static started = false;
    private static listener: Listener | null = null;

    /** Read less often than the rest, and carried over in between. */
    private static slow: { at: number; replication: DcReplication | null; counts: DcDomainView["counts"] } | null = null;
    private static dbcheck: DcDbcheck | null = null;
    private static dbcheckRunning: Promise<DcDbcheck> | null = null;

    /** The most recent measurement, or null before the first one has finished. */
    static latest(): DcHealthReport | null {
        return this.current;
    }

    /** Whether there is anything this agent could measure. */
    static isConfigured(): boolean {
        return DockerService.isConfigured() || LdapService.isConfigured();
    }

    /** Takes the first measurement and starts the loop. `listener` receives what is worth sending. */
    static start(listener: Listener): void {
        this.listener = listener;
        if (this.started || !this.isConfigured()) return;
        this.started = true;
        const stored = DcDbcheckSchema.safeParse(readJsonFile(DBCHECK_FILE));
        this.dbcheck = stored.success ? stored.data : null;

        const loop = async () => {
            await this.measure(false).catch((err) => logger.warn({ err }, "Health measurement failed"));
            this.runScheduledDbcheck();
            const timer = setTimeout(loop, config.health.interval * 1000);
            timer.unref?.();
        };
        void loop();
    }

    /** Measures now, replication included, and hands the result on whether or not it changed. */
    static async refresh(): Promise<DcHealthReport> {
        this.slow = null;
        return this.measure(true);
    }

    /** Forgets what was sent, so the next measurement goes out: for a new server connection. */
    static resetSent(): void {
        this.lastSent = null;
    }

    private static measure(force: boolean): Promise<DcHealthReport> {
        this.inFlight ??= this.collect().finally(() => {
            this.inFlight = null;
        });
        return this.inFlight.then((report) => {
            this.publish(report, force);
            return report;
        });
    }

    private static publish(report: DcHealthReport, force: boolean): void {
        this.current = report;
        // The time of the measurement changes every time; what was measured may not have.
        const signature = JSON.stringify({ ...report, collectedAt: null });
        const now = Date.now();
        const due = !this.lastSent || now - this.lastSent.at >= RESEND_AFTER_MS;
        if (!force && !due && this.lastSent?.signature === signature) return;
        this.lastSent = { at: now, signature };
        this.listener?.(report);
    }

    private static async collect(): Promise<DcHealthReport> {
        const errors: DcHealthReport["errors"] = [];
        const fail = (source: string, err: unknown) => {
            errors.push({ source, message: message(err) });
            logger.debug({ err, source }, "A part of the health measurement could not be read");
        };

        let container: DcContainer | null = null;
        if (DockerService.isConfigured()) {
            try {
                container = await DockerService.inspect();
            } catch (err) {
                fail("container", err);
            }
        }
        // A stopped container answers nothing; asking would only add a timeout per question.
        const sambaMayRun = !container || container.running;

        let identity: DcIdentity | null = null;
        let domain: DcDomainView | null = null;
        if (LdapService.isConfigured() && sambaMayRun) {
            try {
                ({ identity, domain } = await this.readDirectory());
            } catch (err) {
                fail("ldap", err);
                // Not the connection the next measurement should inherit.
                await LdapService.reset();
            }
        }

        const helper = DockerService.isConfigured() && !!container?.running;
        let processes: DcProcess[] | null = null;
        if (helper) {
            try {
                processes = await runSambaHelper("processes");
            } catch (err) {
                fail("processes", err);
            }
        }

        const slowDue = !this.slow || Date.now() - this.slow.at >= config.health.replicationInterval * 1000;
        if (slowDue && sambaMayRun) {
            let replication: DcReplication | null = null;
            if (helper) {
                try {
                    const read = await runSambaHelper("replication");
                    const neighbour = (n: (typeof read.inbound)[number]) => {
                        const partner = parseServerDn(n.partnerDn);
                        return {
                            namingContext: n.namingContext,
                            partner: partner?.name ?? n.partnerDn,
                            partnerSite: partner?.site ?? null,
                            lastAttempt: n.lastAttempt,
                            lastSuccess: n.lastSuccess,
                            consecutiveFailures: n.consecutiveFailures,
                            resultCode: n.resultCode,
                            resultText: n.resultText,
                        };
                    };
                    replication = {
                        collectedAt: new Date().toISOString(),
                        inbound: read.inbound.map(neighbour),
                        outbound: read.outbound.map(neighbour),
                    };
                } catch (err) {
                    fail("replication", err);
                }
            }
            let counts: DcDomainView["counts"] = null;
            if (domain && LdapService.canBind()) {
                try {
                    counts = await this.readCounts(domain.dn);
                } catch (err) {
                    fail("counts", err);
                }
            }
            this.slow = { at: Date.now(), replication, counts };
        }
        if (domain) domain.counts = this.slow?.counts ?? null;

        const host = LdapService.dcHost();
        const ports = host && sambaMayRun ? await this.probePorts(host) : null;

        return {
            collectedAt: new Date().toISOString(),
            container,
            identity,
            domain,
            // What was read a few minutes ago says nothing about a Samba that has stopped since.
            replication: sambaMayRun ? (this.slow?.replication ?? null) : null,
            processes,
            ports,
            dbcheck: this.dbcheck,
            errors,
        };
    }

    /** Who this domain controller is and how it sees its domain. Works without a bind as far as the rootDSE goes. */
    private static async readDirectory(): Promise<{ identity: DcIdentity; domain: DcDomainView | null }> {
        const root = await LdapService.read("", [
            "defaultNamingContext",
            "configurationNamingContext",
            "schemaNamingContext",
            "rootDomainNamingContext",
            "serverName",
            "dnsHostName",
            "vendorVersion",
            "isSynchronized",
            "isGlobalCatalogReady",
            "highestCommittedUSN",
            "domainFunctionality",
            "forestFunctionality",
        ]);
        if (!root) throw new Error("The directory returned no rootDSE");

        const server = parseServerDn(attr(root, "serverName") ?? "");
        const identity: DcIdentity = {
            name: server?.name ?? attr(root, "dnsHostName") ?? "unknown",
            dnsHostName: attr(root, "dnsHostName"),
            site: server?.site ?? null,
            sambaVersion: attr(root, "vendorVersion"),
            isGlobalCatalog: bool(attr(root, "isGlobalCatalogReady")),
            isSynchronized: bool(attr(root, "isSynchronized")),
            highestCommittedUsn: attr(root, "highestCommittedUSN"),
        };

        const domainDn = attr(root, "defaultNamingContext");
        const configDn = attr(root, "configurationNamingContext");
        const schemaDn = attr(root, "schemaNamingContext");
        const forestDn = attr(root, "rootDomainNamingContext");
        // Everything below the rootDSE needs a bind; without one the identity is what there is.
        if (!LdapService.canBind() || !domainDn || !configDn || !schemaDn || !forestDn) {
            return { identity, domain: null };
        }

        // The objects whose `fSMORoleOwner` names the holder -- the ones `samba-tool fsmo show` reads.
        const roleObjects: Record<FsmoRole, string> = {
            schema: schemaDn,
            naming: `CN=Partitions,${configDn}`,
            pdc: domainDn,
            rid: `CN=RID Manager$,CN=System,${domainDn}`,
            infrastructure: `CN=Infrastructure,${domainDn}`,
            domainDns: `CN=Infrastructure,DC=DomainDnsZones,${domainDn}`,
            forestDns: `CN=Infrastructure,DC=ForestDnsZones,${forestDn}`,
        };
        const fsmo: Record<string, string | null> = {};
        await Promise.all(
            FSMO_ROLES.map(async (role) => {
                const entry = await LdapService.read(roleObjects[role], ["fSMORoleOwner"]);
                fsmo[role] = parseServerDn(attr(entry, "fSMORoleOwner") ?? "")?.name ?? null;
            }),
        );

        // Every domain controller of the forest: a server object with NTDS settings below it.
        const entries = await LdapService.search(`CN=Sites,${configDn}`, {
            scope: "sub",
            filter: "(|(objectClass=server)(objectClass=nTDSDSA))",
            attributes: ["objectClass", "dNSHostName", "options"],
        });
        const servers = new Map<string, DirectoryDc>();
        const withNtds = new Map<string, boolean>();
        for (const entry of entries) {
            const parsed = parseServerDn(entry.dn);
            if (!parsed) continue;
            const id = entry.dn.replace(/^CN=NTDS Settings,/i, "").toLowerCase();
            if (/^CN=NTDS Settings,/i.test(entry.dn)) {
                // Bit 0 of `options` on the NTDS settings marks a global catalog.
                withNtds.set(id, ((int(attr(entry, "options")) ?? 0) & 1) === 1);
            } else {
                servers.set(id, { name: parsed.name, site: parsed.site, dnsHostName: attr(entry, "dNSHostName") });
            }
        }
        const controllers = [...servers]
            // A server object without NTDS settings is a demoted or half-removed DC, not one.
            .filter(([id]) => withNtds.has(id))
            .map(([id, dc]) => ({ ...dc, isGlobalCatalog: withNtds.get(id) ?? null }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const domainEntry = await LdapService.read(domainDn, ["msDS-Behavior-Version"]);
        const forestEntry = await LdapService.read(`CN=Partitions,${configDn}`, ["msDS-Behavior-Version"]);

        return {
            identity,
            domain: {
                dn: domainDn,
                dnsName: dnsNameOfDn(domainDn) ?? domainDn,
                domainLevel: int(attr(domainEntry, "msDS-Behavior-Version")) ?? int(attr(root, "domainFunctionality")),
                forestLevel: int(attr(forestEntry, "msDS-Behavior-Version")) ?? int(attr(root, "forestFunctionality")),
                fsmo,
                controllers,
            },
        };
    }

    /** How many users, groups and computers the domain holds. */
    private static async readCounts(domainDn: string): Promise<NonNullable<DcDomainView["counts"]>> {
        const count = async (filter: string) =>
            (await LdapService.search(domainDn, { scope: "sub", filter, attributes: ["1.1"] })).length;
        const [users, groups, computers] = await Promise.all([
            count("(&(objectCategory=person)(objectClass=user))"),
            count("(objectCategory=group)"),
            count("(objectCategory=computer)"),
        ]);
        return { users, groups, computers };
    }

    private static probePorts(host: string): Promise<DcPort[]> {
        return Promise.all(
            DC_PORTS.map(
                ({ name, port }) =>
                    new Promise<DcPort>((resolve) => {
                        const socket = net.connect({ host, port });
                        const done = (open: boolean) => {
                            socket.destroy();
                            resolve({ name, port, open });
                        };
                        socket.setTimeout(PORT_TIMEOUT_MS, () => done(false));
                        socket.once("connect", () => done(true));
                        socket.once("error", () => done(false));
                    }),
            ),
        );
    }

    private static runScheduledDbcheck(): void {
        const hours = config.health.dbcheckIntervalHours;
        if (hours <= 0 || !DockerService.isConfigured() || !this.current?.container?.running) return;
        const last = this.dbcheck ? Date.parse(this.dbcheck.checkedAt) : 0;
        if (Date.now() - last < hours * 3600_000) return;
        void this.runDbcheck().catch(() => undefined);
    }

    /** Runs the database check now. Concurrent callers share the run: two at once would only slow each other. */
    static runDbcheck(): Promise<DcDbcheck> {
        this.dbcheckRunning ??= (async (): Promise<DcDbcheck> => {
            let result: DcDbcheck;
            try {
                const { errors, durationMs } = await runSambaHelper("dbcheck");
                result = { checkedAt: new Date().toISOString(), errors, durationMs };
            } catch (err) {
                logger.warn({ err }, "The database check could not be run");
                result = { checkedAt: new Date().toISOString(), errors: null, error: message(err) };
            }
            this.dbcheck = result;
            writeJsonFile(DBCHECK_FILE, result);
            return result;
        })().finally(() => {
            this.dbcheckRunning = null;
        });
        return this.dbcheckRunning;
    }
}
