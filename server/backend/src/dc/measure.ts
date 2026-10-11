import { lookup } from "dns/promises";
import net from "net";
import type { Entry } from "ldapts";
import {
    DC_SERVICES,
    FSMO_ROLES,
    dnsNameOfDn,
    generalizedTimeToIso,
    guidFromBytes,
    parseServerDn,
    type DcDomainView,
    type DcIdentity,
    type DcMeasurement,
    type DcReplication,
    type DcService,
    type DirectoryDc,
    type FsmoRole,
    type ReplicationNeighbour,
} from "@sadm/shared";
import { DcConnections, dcHost, type DcLocation } from "./DcConnections.js";
import { attr, attrBytes, attrBytesAll, attrs, type DcLdap } from "./DcLdap.js";
import { probeDns } from "./probes/dns.js";
import { probeKerberos } from "./probes/kerberos.js";
import { probeTcp, socketReason, type ProbeResult } from "./probes/tcp.js";
import { decodeRepsBlob } from "./repsBlob.js";
import { werrorText } from "./werror.js";

/** How long a service may take to answer. The domain controllers are a network away, not a continent. */
const PROBE_TIMEOUT_MS = 4000;

/** What a domain controller tells anyone who asks: who it is, and what time it thinks it is. */
const ROOT_ATTRIBUTES = [
    "defaultNamingContext",
    "configurationNamingContext",
    "schemaNamingContext",
    "rootDomainNamingContext",
    "namingContexts",
    "serverName",
    "dsServiceName",
    "dnsHostName",
    "vendorVersion",
    "isSynchronized",
    "isGlobalCatalogReady",
    "highestCommittedUSN",
    "domainFunctionality",
    "forestFunctionality",
    "currentTime",
];

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const bool = (value: string | null): boolean | null => (value === null ? null : value.toUpperCase() === "TRUE");

const int = (value: string | null): number | null => {
    if (value === null) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
};

/** The parts of a measurement that are read less often than the rest, and carried over in between. */
export interface SlowParts {
    replication: DcReplication | null;
    counts: DcDomainView["counts"];
    errors: DcMeasurement["errors"];
}

export interface MeasureInput {
    dc: DcLocation & { name: string };
    /**
     * The domain's DNS name, as the last measurement that could read it gave it. DNS and
     * Kerberos are asked about the domain, so without its name they can only be connected to.
     */
    domainDnsName: string | null;
    /** What was read of the slow parts last time; null to read them now. */
    slow: SlowParts | null;
}

export interface MeasureOutput {
    measurement: DcMeasurement;
    /** The slow parts as they stand after this measurement: `input.slow`, or what was read. */
    slow: SlowParts | null;
}

/** The rootDSE of a domain controller with the offset of its clock from this server's. */
interface RootRead {
    root: Entry;
    clockOffsetMs: number | null;
}

/**
 * Reads the rootDSE on a connection of its own, without a bind. This is the test of the
 * directory service: a real search and a real answer, and one that does not depend on the
 * account this server uses -- a wrong password must not read as a directory that is down.
 */
async function readRoot(dc: DcLocation): Promise<RootRead> {
    const ldap = DcConnections.anonymous(dc);
    try {
        const sent = Date.now();
        const root = await ldap.read("", ROOT_ATTRIBUTES);
        const received = Date.now();
        if (!root) throw new Error("the directory returned no rootDSE");
        const theirs = Date.parse(generalizedTimeToIso(attr(root, "currentTime")) ?? "");
        // Against the middle of the exchange: the answer was written somewhere in between.
        return { root, clockOffsetMs: Number.isNaN(theirs) ? null : Math.round(theirs - (sent + received) / 2) };
    } finally {
        await ldap.reset();
    }
}

function identityOf(root: Entry): DcIdentity {
    const server = parseServerDn(attr(root, "serverName") ?? "");
    return {
        name: server?.name ?? attr(root, "dnsHostName") ?? "unknown",
        dnsHostName: attr(root, "dnsHostName"),
        site: server?.site ?? null,
        sambaVersion: attr(root, "vendorVersion"),
        isGlobalCatalog: bool(attr(root, "isGlobalCatalogReady")),
        isSynchronized: bool(attr(root, "isSynchronized")),
        highestCommittedUsn: attr(root, "highestCommittedUSN"),
    };
}

/**
 * How a domain controller sees its domain: the functional levels, who holds the FSMO roles,
 * and which domain controllers there are. Needs a bound connection -- none of this is in the
 * rootDSE. Also what the list of domain controllers this server keeps is read from.
 */
export async function readDomainView(ldap: DcLdap, root: Entry): Promise<DcDomainView> {
    const domainDn = attr(root, "defaultNamingContext");
    const configDn = attr(root, "configurationNamingContext");
    const schemaDn = attr(root, "schemaNamingContext");
    const forestDn = attr(root, "rootDomainNamingContext");
    if (!domainDn || !configDn || !schemaDn || !forestDn) throw new Error("The rootDSE does not name the directory's partitions");

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
            const entry = await ldap.read(roleObjects[role], ["fSMORoleOwner"]);
            fsmo[role] = parseServerDn(attr(entry, "fSMORoleOwner") ?? "")?.name ?? null;
        }),
    );

    // Every domain controller of the forest: a server object with NTDS settings below it.
    const entries = await ldap.search(`CN=Sites,${configDn}`, {
        scope: "sub",
        filter: "(|(objectClass=server)(objectClass=nTDSDSA))",
        attributes: ["objectClass", "objectGUID", "dNSHostName", "options"],
        explicitBufferAttributes: ["objectGUID"],
    });
    const servers = new Map<string, { name: string; site: string | null; dnsHostName: string | null }>();
    const ntds = new Map<string, { id: string; isGlobalCatalog: boolean }>();
    for (const entry of entries) {
        const parsed = parseServerDn(entry.dn);
        if (!parsed) continue;
        const key = entry.dn.replace(/^CN=NTDS Settings,/i, "").toLowerCase();
        if (/^CN=NTDS Settings,/i.test(entry.dn)) {
            const bytes = attrBytes(entry, "objectGUID");
            const id = bytes && guidFromBytes(bytes);
            // Bit 0 of `options` on the NTDS settings marks a global catalog.
            if (id) ntds.set(key, { id, isGlobalCatalog: ((int(attr(entry, "options")) ?? 0) & 1) === 1 });
        } else {
            servers.set(key, { name: parsed.name, site: parsed.site, dnsHostName: attr(entry, "dNSHostName") });
        }
    }
    const controllers: DirectoryDc[] = [...servers]
        // A server object without NTDS settings is a demoted or half-removed DC, not one.
        .flatMap(([key, server]) => {
            const settings = ntds.get(key);
            return settings ? [{ ...server, id: settings.id, isGlobalCatalog: settings.isGlobalCatalog }] : [];
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    const domainEntry = await ldap.read(domainDn, ["msDS-Behavior-Version"]);
    const forestEntry = await ldap.read(`CN=Partitions,${configDn}`, ["msDS-Behavior-Version"]);

    return {
        dn: domainDn,
        dnsName: dnsNameOfDn(domainDn) ?? domainDn,
        domainLevel: int(attr(domainEntry, "msDS-Behavior-Version")) ?? int(attr(root, "domainFunctionality")),
        forestLevel: int(attr(forestEntry, "msDS-Behavior-Version")) ?? int(attr(root, "forestFunctionality")),
        fsmo,
        controllers,
    };
}

/** The replication links of every naming context, from the `repsFrom` and `repsTo` on its head. */
async function readReplication(ldap: DcLdap, root: Entry, controllers: readonly DirectoryDc[]): Promise<DcReplication> {
    const byId = new Map(controllers.map((dc) => [dc.id.toLowerCase(), dc]));
    const inbound: ReplicationNeighbour[] = [];
    const outbound: ReplicationNeighbour[] = [];
    for (const namingContext of attrs(root, "namingContexts")) {
        const head = await ldap.read(namingContext, ["repsFrom", "repsTo"], { explicitBufferAttributes: ["repsFrom", "repsTo"] });
        for (const [attribute, into] of [["repsFrom", inbound], ["repsTo", outbound]] as const) {
            for (const bytes of attrBytesAll(head, attribute)) {
                const link = decodeRepsBlob(bytes);
                if (!link) throw new Error(`A ${attribute} value on ${namingContext} is in a form this server does not know`);
                const partner = byId.get(link.partnerId.toLowerCase());
                into.push({
                    namingContext,
                    partner: partner?.name ?? link.partnerId,
                    partnerSite: partner?.site ?? null,
                    lastAttempt: link.lastAttempt,
                    lastSuccess: link.lastSuccess,
                    consecutiveFailures: link.consecutiveFailures,
                    resultCode: link.resultCode,
                    resultText: werrorText(link.resultCode),
                });
            }
        }
    }
    return { collectedAt: new Date().toISOString(), inbound, outbound };
}

/** How many users, groups and computers the domain holds. */
async function readCounts(ldap: DcLdap, domainDn: string): Promise<NonNullable<DcDomainView["counts"]>> {
    const count = async (filter: string) => (await ldap.search(domainDn, { scope: "sub", filter, attributes: ["1.1"] })).length;
    const [users, groups, computers] = await Promise.all([
        count("(&(objectCategory=person)(objectClass=user))"),
        count("(objectCategory=group)"),
        count("(objectCategory=computer)"),
    ]);
    return { users, groups, computers };
}

/** Every service as not answering, for one reason: there is nowhere to ask. */
const nothingAnswers = (detail: string): DcService[] =>
    DC_SERVICES.map(({ name, port, check }) => ({ name, port, check, ok: false, detail }));

/**
 * Measures one domain controller over the network: asks each of its services whether it is
 * there, and reads from its directory who it is, how it sees the domain and how its
 * replication links are doing.
 *
 * A part that cannot be read is left out and named in `errors`; the rest is still reported.
 * That is the point of measuring from outside: a domain controller whose directory no
 * longer answers is exactly the one that has to be reported.
 */
export async function measureDc(input: MeasureInput): Promise<MeasureOutput> {
    const { dc, domainDnsName } = input;
    const collectedAt = new Date().toISOString();
    const empty = (services: DcService[]): MeasureOutput => ({
        measurement: { collectedAt, identity: null, domain: null, replication: null, services, clockOffsetMs: null, errors: [] },
        slow: null,
    });

    const host = dcHost(dc);
    if (!host) return empty(nothingAnswers("the directory names no host for it, and no address is set"));

    // The resolver is told an address, and every other probe may as well use the same one.
    let address = host;
    if (!net.isIP(host)) {
        try {
            address = (await lookup(host)).address;
        } catch {
            return empty(nothingAnswers(`the name ${host} does not resolve`));
        }
    }

    let rootRead: RootRead | null = null;
    const probe = async ({ name, port, check }: (typeof DC_SERVICES)[number]): Promise<DcService> => {
        let asked: DcService["check"] = check;
        let result: ProbeResult;
        if (port === 636) {
            const started = Date.now();
            try {
                rootRead = await readRoot(dc);
                result = { ok: true, latencyMs: Date.now() - started };
            } catch (err) {
                result = { ok: false, detail: socketReason(err) };
            }
        } else if (port === 53 && domainDnsName) {
            result = await probeDns(address, domainDnsName, PROBE_TIMEOUT_MS);
        } else if (port === 88 && domainDnsName) {
            result = await probeKerberos(address, domainDnsName, PROBE_TIMEOUT_MS);
        } else {
            // Also DNS and Kerberos while the domain's name is not known yet.
            asked = "connect";
            result = await probeTcp(address, port, PROBE_TIMEOUT_MS);
        }
        return { name, port, check: asked, ok: result.ok, detail: result.detail ?? null, latencyMs: result.latencyMs ?? null };
    };
    const services = await Promise.all(DC_SERVICES.map(probe));
    const read = rootRead as RootRead | null;
    if (!read) return { ...empty(services), slow: null };

    const identity = identityOf(read.root);
    if (identity.name.toUpperCase() !== dc.name.toUpperCase()) {
        // An address that leads to another domain controller: what it says is not about this one.
        const ldaps = services.find((service) => service.port === 636);
        if (ldaps) Object.assign(ldaps, { ok: false, detail: `${host} answers as ${identity.name}, not as ${dc.name}` });
        return empty(services);
    }

    const errors: DcMeasurement["errors"] = [];
    const fail = (source: string, err: unknown) => errors.push({ source, message: message(err) });

    let domain: DcDomainView | null = null;
    let slow = input.slow;
    if (DcConnections.canBind()) {
        const ldap = DcConnections.for(dc);
        try {
            domain = await readDomainView(ldap, read.root);
        } catch (err) {
            fail("directory", err);
            // Not the connection the next measurement should inherit.
            await ldap.reset();
        }
        if (domain && !slow) {
            const slowErrors: DcMeasurement["errors"] = [];
            let replication: DcReplication | null = null;
            let counts: DcDomainView["counts"] = null;
            try {
                replication = await readReplication(ldap, read.root, domain.controllers);
            } catch (err) {
                slowErrors.push({ source: "replication", message: message(err) });
            }
            try {
                counts = await readCounts(ldap, domain.dn);
            } catch (err) {
                slowErrors.push({ source: "counts", message: message(err) });
            }
            slow = { replication, counts, errors: slowErrors };
        }
    } else {
        fail("directory", new Error("No account for the directory is configured (directory.bindDn and SADM_LDAP_PASSWORD)"));
    }

    if (domain) domain.counts = slow?.counts ?? null;
    return {
        measurement: {
            collectedAt,
            identity,
            domain,
            // What was read a few minutes ago says nothing once the directory no longer answers.
            replication: domain ? (slow?.replication ?? null) : null,
            services,
            clockOffsetMs: read.clockOffsetMs,
            errors: [...errors, ...(domain ? (slow?.errors ?? []) : [])],
        },
        slow: domain ? slow : null,
    };
}
