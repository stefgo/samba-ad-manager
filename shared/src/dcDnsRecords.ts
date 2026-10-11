import type { DnsRecordData } from "./dns.js";

/**
 * The DNS records a domain controller registers for itself, and whether they are there.
 *
 * A domain controller is found through DNS and through nothing else: a client asks for
 * `_ldap._tcp.dc._msdcs.<domain>`, a replication partner for `<GUID>._msdcs.<forest>`. Each
 * domain controller puts its own records there and keeps them there -- Samba's
 * `samba_dnsupdate` works off a list, `dns_update_list`, every ten minutes. When that stops
 * working, nothing says so: the records of a domain controller that joined last week are
 * simply missing, and replication to it fails with an error about a name.
 *
 * `expectedDcRecords` is that list. It follows Samba's file line by line -- which records,
 * under which condition -- so that what is expected here is what Samba would register.
 * Left out are the stub entries in a parent zone (the lines marked `RPC`): they belong to
 * another domain.
 */

/** What is known of a domain controller that decides which records it registers. */
export interface DcRecordFacts {
    /** `dc1.sadm.test` */
    hostName: string;
    /** The GUID of its NTDS settings. */
    ntdsGuid: string;
    site: string;
    isGlobalCatalog: boolean;
    isPdc: boolean;
    isReadOnly: boolean;
    /** Whether it holds the partition `DomainDnsZones`, and so answers DNS for the domain. */
    holdsDomainDns: boolean;
    holdsForestDns: boolean;
}

export interface DomainRecordFacts {
    /** `sadm.test` */
    domain: string;
    /** The forest's root domain; the same as `domain` in a forest of one. */
    forest: string;
    /** The `objectGUID` of the domain; null where it could not be read, and the record under it is then not expected. */
    domainGuid: string | null;
}

/**
 * One record a domain controller should have.
 *
 * - `host`: the domain controller's own name has an address.
 * - `address`: `name` lists every address of the domain controller.
 * - `cname`, `ns`, `srv`: `name` has such a record that names the domain controller.
 */
export interface ExpectedDcRecord {
    kind: "host" | "address" | "cname" | "ns" | "srv";
    /** The name the record is under, fully qualified, lower case. */
    name: string;
    /** For `srv`. */
    port?: number;
    /** Without it the domain controller is not found: by clients, or by its replication partners. */
    essential: boolean;
}

const lower = (name: string) => name.toLowerCase().replace(/\.$/, "");

/** The records a domain controller registers for itself, as `dns_update_list` has them. */
export function expectedDcRecords(dc: DcRecordFacts, facts: DomainRecordFacts): ExpectedDcRecord[] {
    const host = lower(dc.hostName);
    const domain = lower(facts.domain);
    const forest = lower(facts.forest);
    const site = dc.site.toLowerCase();

    // The conditions of the list. A read-only domain controller is one, and writes nothing.
    const rw = !dc.isReadOnly;
    const rwGc = rw && dc.isGlobalCatalog;
    const rwDnsDomain = rw && dc.holdsDomainDns;
    const rwDnsForest = rw && dc.holdsForestDns;

    const records: ExpectedDcRecord[] = [];
    const add = (when: boolean, kind: ExpectedDcRecord["kind"], name: string, port?: number, essential = false) => {
        if (when) records.push({ kind, name, ...(port === undefined ? {} : { port }), essential });
    };
    const srv = (when: boolean, name: string, port: number, essential = false) => add(when, "srv", name, port, essential);

    add(true, "host", host, undefined, true);
    add(true, "cname", `${dc.ntdsGuid.toLowerCase()}._msdcs.${forest}`, undefined, true);
    add(rwDnsDomain, "ns", domain);
    add(rwDnsForest, "ns", forest);
    add(rwDnsForest, "ns", `_msdcs.${forest}`);

    // A writable domain controller
    add(rw, "address", domain);
    srv(rw, `_ldap._tcp.${domain}`, 389);
    srv(rw, `_ldap._tcp.dc._msdcs.${domain}`, 389, true);
    srv(rw && !!facts.domainGuid, `_ldap._tcp.${facts.domainGuid?.toLowerCase()}.domains._msdcs.${forest}`, 389);
    srv(rw, `_kerberos._tcp.${domain}`, 88);
    srv(rw, `_kerberos._udp.${domain}`, 88);
    srv(rw, `_kerberos._tcp.dc._msdcs.${domain}`, 88, true);
    srv(rw, `_kpasswd._tcp.${domain}`, 464);
    srv(rw, `_kpasswd._udp.${domain}`, 464);

    // Any domain controller, in its site
    srv(true, `_ldap._tcp.${site}._sites.${domain}`, 389);
    srv(true, `_ldap._tcp.${site}._sites.dc._msdcs.${domain}`, 389);
    srv(true, `_kerberos._tcp.${site}._sites.${domain}`, 88);
    srv(true, `_kerberos._tcp.${site}._sites.dc._msdcs.${domain}`, 88);

    srv(dc.isPdc, `_ldap._tcp.pdc._msdcs.${domain}`, 389);

    // A global catalog
    add(rwGc, "address", `gc._msdcs.${forest}`);
    srv(rwGc, `_gc._tcp.${forest}`, 3268);
    srv(rwGc, `_ldap._tcp.gc._msdcs.${forest}`, 3268);
    srv(dc.isGlobalCatalog, `_gc._tcp.${site}._sites.${forest}`, 3268);
    srv(dc.isGlobalCatalog, `_ldap._tcp.${site}._sites.gc._msdcs.${forest}`, 3268);

    // A DNS server of the domain, and of the forest
    add(rwDnsDomain, "address", `domaindnszones.${domain}`);
    srv(rwDnsDomain, `_ldap._tcp.domaindnszones.${domain}`, 389);
    srv(dc.holdsDomainDns, `_ldap._tcp.${site}._sites.domaindnszones.${domain}`, 389);
    add(rwDnsForest, "address", `forestdnszones.${forest}`);
    srv(rwDnsForest, `_ldap._tcp.forestdnszones.${forest}`, 389);
    srv(dc.holdsForestDns, `_ldap._tcp.${site}._sites.forestdnszones.${forest}`, 389);

    // In a forest of one domain two lines of the list name the same record.
    const seen = new Set<string>();
    return records.filter((record) => {
        const key = `${record.kind}|${record.name}|${record.port ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** An expected record as a reader is told it is missing: `SRV _ldap._tcp.sadm.test (port 389)`. */
export function describeExpectedRecord(record: ExpectedDcRecord): string {
    switch (record.kind) {
        case "host":
            return `A ${record.name}`;
        case "address":
            return `A ${record.name} (its address)`;
        case "cname":
            return `CNAME ${record.name}`;
        case "ns":
            return `NS ${record.name}`;
        case "srv":
            return `SRV ${record.name} (port ${record.port})`;
    }
}

/** The records under a name, by its fully qualified lower-case form; none for a name that is not there. */
export type RecordsAt = (name: string) => readonly DnsRecordData[];

const addressesAt = (recordsAt: RecordsAt, name: string): string[] =>
    recordsAt(name).flatMap((data) => (data.type === "A" || data.type === "AAAA" ? [data.address.toLowerCase()] : []));

/** Which of the records a domain controller should have are not there. */
export function missingDcRecords(expected: readonly ExpectedDcRecord[], hostName: string, recordsAt: RecordsAt): ExpectedDcRecord[] {
    const host = lower(hostName);
    const own = addressesAt(recordsAt, host);
    return expected.filter((record) => {
        const records = recordsAt(record.name);
        switch (record.kind) {
            case "host":
                return own.length === 0;
            case "address": {
                // Without an address of its own there is none to look for: that is the finding above.
                const there = new Set(addressesAt(recordsAt, record.name));
                return own.some((address) => !there.has(address));
            }
            case "cname":
                return !records.some((data) => data.type === "CNAME" && lower(data.target) === host);
            case "ns":
                return !records.some((data) => data.type === "NS" && lower(data.target) === host);
            case "srv":
                return !records.some((data) => data.type === "SRV" && lower(data.target) === host && data.port === record.port);
        }
    });
}

/** A record under one of the domain controllers' names that names something that is none. */
export interface StaleDcRecord {
    /** What it names: a host name, or an address. */
    target: string;
    type: "SRV" | "CNAME" | "A" | "AAAA";
    /** The name the record is under. */
    name: string;
}

/**
 * What the names the domain controllers register under still say about a domain controller
 * that is none (any more): an SRV record or a replication alias for a host that is no
 * domain controller, an address under a shared name that is no domain controller's.
 *
 * `names` are the names to look under -- those of `expectedDcRecords` for every domain
 * controller, and whatever else was read of `_msdcs`. NS records are left alone: a zone
 * lists its secondaries there, and those are no domain controllers by design.
 */
export function staleDcRecords(
    names: readonly { name: string; kinds: ReadonlySet<ExpectedDcRecord["kind"]> }[],
    dcHostNames: readonly string[],
    recordsAt: RecordsAt,
): StaleDcRecord[] {
    const hosts = new Set(dcHostNames.map(lower));
    const addresses = new Set([...hosts].flatMap((host) => addressesAt(recordsAt, host)));
    const stale: StaleDcRecord[] = [];
    for (const { name, kinds } of names) {
        // A domain controller's own name holds its own addresses, whatever they are.
        if (kinds.has("host")) continue;
        for (const data of recordsAt(name)) {
            if (data.type === "SRV" && kinds.has("srv") && !hosts.has(lower(data.target))) {
                stale.push({ target: lower(data.target), type: "SRV", name });
            } else if (data.type === "CNAME" && kinds.has("cname") && !hosts.has(lower(data.target))) {
                stale.push({ target: lower(data.target), type: "CNAME", name });
            } else if ((data.type === "A" || data.type === "AAAA") && kinds.has("address") && !addresses.has(data.address.toLowerCase())) {
                stale.push({ target: data.address.toLowerCase(), type: data.type, name });
            }
        }
    }
    return stale;
}

/** The zone that holds a name, and the name within it: the longest zone the name ends in. Null where no zone does. */
export function locateInZones(name: string, zoneNames: readonly string[]): { zone: string; node: string } | null {
    const fqdn = lower(name);
    let best: string | null = null;
    for (const zone of zoneNames) {
        const candidate = lower(zone);
        if (fqdn !== candidate && !fqdn.endsWith(`.${candidate}`)) continue;
        if (best === null || candidate.length > lower(best).length) best = zone;
    }
    if (best === null) return null;
    const zone = lower(best);
    return { zone: best, node: fqdn === zone ? "@" : fqdn.slice(0, fqdn.length - zone.length - 1) };
}
