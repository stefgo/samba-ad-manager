import type { Entry } from "ldapts";
import {
    GUID_PATTERN,
    dnsFqdn,
    dnsRecordConflict,
    dnsRecordText,
    dnsRecordTypeLabel,
    escapeFilterValue,
    escapeRdnValue,
    guidDn,
    guidFromBytes,
    isDnWithin,
    isManagedDnsType,
    locateInZones,
    nextSerial,
    sameDnsRecord,
    type DirectoryChanged,
    type DnsNode,
    type DnsRecord,
    type DnsRecordData,
    type DnsZone,
    type DnsZoneDetail,
    type DnsZonePartition,
    type DnsZoneSoa,
} from "@sadm/shared";
import { addValues, attr, attrBytes, attrBytesAll, attrs, deleteValues, ldapCode, replace, type DcLdap } from "../dc/DcLdap.js";
import { DirectoryError } from "../directory/DirectoryError.js";
import { directoryError, notFound } from "../directory/DirectoryOperations.js";
import { dcHostNameSet, isDeletableRecord, isProtectedNode, isProtectedRecord, type DomainControllerNames } from "./dnsProtection.js";
import { decodeDnsRecord, encodeDnsRecord, isoOfDnsTimestamp, staticHead, type DnsRecordHead } from "./dnsRecord.js";

const BINARY = ["objectGUID", "dnsRecord"];

/**
 * Zones that are in the directory and are no zone of the domain: the root hints, and the
 * trust anchors a Windows DNS server keeps for DNSSEC.
 */
const isHiddenZone = (name: string): boolean => name.toLowerCase() === "rootdnsservers" || name.startsWith("..");

const guidOf = (entry: Entry): string => {
    const bytes = attrBytes(entry, "objectGUID");
    return (bytes && guidFromBytes(bytes)) ?? "";
};

const isTombstoned = (entry: Entry): boolean => attr(entry, "dNSTombstoned")?.toUpperCase() === "TRUE";

interface LiveRecord {
    head: DnsRecordHead;
    data: DnsRecordData;
    /** The value as the directory holds it: what a change names the record it replaces by. */
    bytes: Uint8Array;
}

/** The records of a node that are records: what does not decode is left out, and so is a tombstone. */
function recordsOf(entry: Entry): LiveRecord[] {
    return attrBytesAll(entry, "dnsRecord").flatMap((bytes) => {
        const record = decodeDnsRecord(bytes);
        return record && record.data.type !== "tombstone" ? [{ head: record.head, data: record.data, bytes }] : [];
    });
}

/** The LDAP result for "that value is not there": somebody changed the attribute between the reading and the writing. */
const NO_SUCH_ATTRIBUTE = 16;

/** How often the serial number is tried again when another writer got there first. */
const SERIAL_ATTEMPTS = 3;

/** What was changed, for the record of who did what. */
export interface DnsChanged extends DirectoryChanged {
    /** The zone the record is in. */
    zone: string;
    /** The record as it is after the change -- or was, for one that was deleted. */
    record: string;
    /** What a changed record said before. */
    was?: string;
    /** A change that asked for what was there already: nothing was written, and there is nothing to record. */
    unchanged?: boolean;
}

const describe = (data: DnsRecordData): string => `${dnsRecordTypeLabel(data)} ${dnsRecordText(data)}`;

/** How many names go into one filter when a list of them is read. */
const NAMES_CHUNK = 40;

/** Records in the order a reader looks for them: by type, then by what they say. */
const TYPE_ORDER = ["SOA", "NS", "A", "AAAA", "CNAME", "PTR", "MX", "SRV", "TXT", "other"];

interface ZoneBase {
    dn: string;
    partition: DnsZonePartition;
}

/**
 * The DNS zones of the domain, read on one domain controller.
 *
 * They are in the directory, below `CN=MicrosoftDNS` in the two DNS partitions -- and, in a
 * domain that was upgraded from an old one, below `CN=System` of the domain itself. A zone
 * is a `dnsZone`, each of its names a `dnsNode` directly below it, however many dots the
 * name has.
 */
export class DnsOperations {
    private zoneBases: ZoneBase[] | null = null;

    constructor(
        private readonly ldap: DcLdap,
        private readonly options: { readOnly: boolean } = { readOnly: true },
    ) {}

    private assertWritable(): void {
        if (this.options.readOnly) {
            throw new DirectoryError("forbidden", "The directory is read-only here (directory.readOnly is true)");
        }
    }

    private async bases(): Promise<ZoneBase[]> {
        if (this.zoneBases) return this.zoneBases;
        const root = await this.ldap.read("", ["defaultNamingContext", "rootDomainNamingContext"]);
        const domainDn = attr(root, "defaultNamingContext");
        const forestDn = attr(root, "rootDomainNamingContext") ?? domainDn;
        if (!domainDn || !forestDn) throw new DirectoryError("failed", "The directory does not name its domain");
        this.zoneBases = [
            { dn: `CN=MicrosoftDNS,DC=DomainDnsZones,${domainDn}`, partition: "domain" },
            { dn: `CN=MicrosoftDNS,DC=ForestDnsZones,${forestDn}`, partition: "forest" },
            { dn: `CN=MicrosoftDNS,CN=System,${domainDn}`, partition: "legacy" },
        ];
        return this.zoneBases;
    }

    /** A search below one of the places zones are kept; nothing where that place does not exist. */
    private async searchBase(base: string, options: Parameters<DcLdap["search"]>[1]): Promise<Entry[]> {
        try {
            return await this.ldap.search(base, options);
        } catch (err) {
            if (ldapCode(err) === 32) return [];
            throw directoryError(err, "zone");
        }
    }

    /**
     * The domain controllers as the protection of their records needs them: their host
     * names, and the addresses the zones hold under those.
     */
    private async domainControllers(): Promise<DomainControllerNames> {
        const root = await this.ldap.read("", ["defaultNamingContext"]);
        const domainDn = attr(root, "defaultNamingContext");
        if (!domainDn) return { hostNames: new Set(), addresses: new Set() };
        // 8192 is SERVER_TRUST_ACCOUNT: the account of a domain controller.
        const entries = await this.ldap.search(domainDn, {
            scope: "sub",
            filter: "(&(objectCategory=computer)(userAccountControl:1.2.840.113556.1.4.803:=8192))",
            attributes: ["dNSHostName"],
        });
        const hostNames = dcHostNameSet(entries.map((entry) => attr(entry, "dNSHostName")));
        const { records } = await this.recordsUnder([...hostNames]);
        const addresses = new Set(
            [...records.values()].flat().flatMap((data) => (data.type === "A" || data.type === "AAAA" ? [data.address.toLowerCase()] : [])),
        );
        return { hostNames, addresses };
    }

    private zoneOf(entry: Entry, partition: DnsZonePartition, apex: Entry | null, nodeCount: number): DnsZone {
        const records = apex ? recordsOf(apex) : [];
        let soa: DnsZoneSoa | null = null;
        const nameServers: string[] = [];
        for (const { data } of records) {
            if (data.type === "SOA") {
                soa = {
                    serial: data.serial,
                    refresh: data.refresh,
                    retry: data.retry,
                    expire: data.expire,
                    minimum: data.minimum,
                    primary: data.primary,
                    mailbox: data.mailbox,
                };
            } else if (data.type === "NS") {
                nameServers.push(data.target);
            }
        }
        return {
            guid: guidOf(entry),
            name: attr(entry, "name") ?? "",
            dn: entry.dn,
            partition,
            soa,
            nameServers: nameServers.sort((a, b) => a.localeCompare(b)),
            nodeCount,
        };
    }

    /** The node `@` of a zone: the zone's own records. */
    private apexOf(zoneDn: string): Promise<Entry | null> {
        return this.ldap.read(`DC=@,${zoneDn}`, ["dnsRecord"], { explicitBufferAttributes: BINARY });
    }

    /** The zones below one of the places they are kept, without the ones that are no zones of the domain. */
    private async zoneEntries(base: ZoneBase): Promise<Entry[]> {
        const entries = await this.searchBase(base.dn, {
            scope: "one",
            filter: "(objectClass=dnsZone)",
            attributes: ["objectGUID", "name"],
            explicitBufferAttributes: BINARY,
        });
        return entries.filter((entry) => !isHiddenZone(attr(entry, "name") ?? ""));
    }

    /**
     * Every zone with what it says about itself, and nothing of what is in it: what a
     * measurement needs to ask each name server about each zone.
     */
    async zoneHeads(): Promise<Pick<DnsZone, "name" | "dn" | "soa" | "nameServers">[]> {
        const heads: Pick<DnsZone, "name" | "dn" | "soa" | "nameServers">[] = [];
        for (const base of await this.bases()) {
            for (const entry of await this.zoneEntries(base)) {
                const { name, dn, soa, nameServers } = this.zoneOf(entry, base.partition, await this.apexOf(entry.dn), 0);
                heads.push({ name, dn, soa, nameServers });
            }
        }
        return heads.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * The records under some names, wherever in the zones they are: by fully qualified,
     * lower-case name. A name no zone holds, or that is not there, has no entry.
     *
     * With a `forest`, the replication aliases in `_msdcs.<forest>` come with them -- the
     * names that are a GUID -- whether asked for or not: one that belongs to no domain
     * controller is only found by looking at all of them.
     */
    async recordsUnder(names: readonly string[], forest?: string): Promise<{ records: Map<string, DnsRecordData[]>; aliases: string[] }> {
        const zones = await this.zoneHeads();
        const zoneNames = zones.map((zone) => zone.name);
        const records = new Map<string, DnsRecordData[]>();
        const read = async (zoneName: string, filter: string) => {
            const zone = zones.find((candidate) => candidate.name === zoneName);
            if (!zone) return [];
            const entries = await this.searchBase(zone.dn, {
                scope: "one",
                filter: `(&(objectClass=dnsNode)(!(dNSTombstoned=TRUE))${filter})`,
                attributes: ["name", "dnsRecord"],
                explicitBufferAttributes: BINARY,
            });
            return entries.map((entry) => {
                const fqdn = dnsFqdn(attr(entry, "name") ?? "", zone.name).toLowerCase();
                records.set(fqdn, recordsOf(entry).map(({ data }) => data));
                return fqdn;
            });
        };

        const byZone = new Map<string, string[]>();
        for (const name of names) {
            const place = locateInZones(name, zoneNames);
            if (place) byZone.set(place.zone, [...(byZone.get(place.zone) ?? []), place.node]);
        }
        for (const [zone, nodes] of byZone) {
            for (let i = 0; i < nodes.length; i += NAMES_CHUNK) {
                const chunk = nodes.slice(i, i + NAMES_CHUNK);
                await read(zone, `(|${chunk.map((node) => `(name=${escapeFilterValue(node)})`).join("")})`);
            }
        }

        if (!forest) return { records, aliases: [] };
        // `x._msdcs.<forest>` is a name of the zone `_msdcs.<forest>`, or of the forest's own zone where that is none.
        const place = locateInZones(`x._msdcs.${forest}`, zoneNames);
        const suffix = place ? place.node.slice(1) : "";
        const found = place ? await read(place.zone, `(name=*-*-*-*-*${escapeFilterValue(suffix)})`) : [];
        const aliases = found.filter((fqdn) => GUID_PATTERN.test(fqdn.split(".")[0]));
        return { records, aliases };
    }

    async listZones(): Promise<{ zones: DnsZone[] }> {
        const zones: DnsZone[] = [];
        for (const base of await this.bases()) {
            const shown = await this.zoneEntries(base);
            if (shown.length === 0) continue;

            // One search for the names of every zone here, rather than one per zone.
            const nodes = await this.searchBase(base.dn, {
                scope: "sub",
                filter: "(&(objectClass=dnsNode)(!(dNSTombstoned=TRUE))(!(name=@)))",
                attributes: ["1.1"],
            });
            const counts = new Map<string, number>();
            for (const node of nodes) {
                const zoneDn = shown.find((zone) => isDnWithin(node.dn, zone.dn))?.dn;
                if (zoneDn) counts.set(zoneDn, (counts.get(zoneDn) ?? 0) + 1);
            }
            for (const entry of shown) {
                zones.push(this.zoneOf(entry, base.partition, await this.apexOf(entry.dn), counts.get(entry.dn) ?? 0));
            }
        }
        return { zones: zones.sort((a, b) => a.name.localeCompare(b.name)) };
    }

    /** The zone a GUID names; a `not-found` refusal for anything that is none, or none that is shown. */
    private async zoneEntry(guid: string): Promise<{ entry: Entry; partition: DnsZonePartition }> {
        let entry: Entry | null;
        try {
            entry = await this.ldap.read(guidDn(guid), ["objectGUID", "objectClass", "name"], { explicitBufferAttributes: BINARY });
        } catch (err) {
            throw directoryError(err, "zone");
        }
        const isZone = !!entry && attrs(entry, "objectClass").some((name) => name.toLowerCase() === "dnszone");
        const base = entry && (await this.bases()).find((candidate) => isDnWithin(entry.dn, candidate.dn));
        if (!entry || !isZone || !base || isHiddenZone(attr(entry, "name") ?? "")) throw notFound("zone");
        return { entry, partition: base.partition };
    }

    async getZone({ guid }: { guid: string }): Promise<DnsZoneDetail> {
        const { entry, partition } = await this.zoneEntry(guid);
        const zoneName = attr(entry, "name") ?? "";
        const [entries, dcs] = await Promise.all([
            this.searchBase(entry.dn, {
                scope: "one",
                filter: "(objectClass=dnsNode)",
                attributes: ["objectGUID", "name", "dnsRecord", "dNSTombstoned"],
                explicitBufferAttributes: BINARY,
            }),
            this.domainControllers(),
        ]);

        const nodes: DnsNode[] = [];
        let apex: Entry | null = null;
        for (const node of entries) {
            if (isTombstoned(node)) continue;
            const name = attr(node, "name") ?? "";
            if (name === "@") apex = node;
            const fqdn = dnsFqdn(name, zoneName);
            const protectedNode = isProtectedNode(zoneName, name);
            const records: DnsRecord[] = recordsOf(node)
                .map(({ head, data }) => ({
                    data,
                    ttl: head.ttl,
                    registeredAt: isoOfDnsTimestamp(head.timestamp),
                    protected: protectedNode || isProtectedRecord(fqdn, data, dcs.hostNames),
                    deletable: isDeletableRecord(zoneName, name, fqdn, data, dcs),
                }))
                .sort(
                    (a, b) =>
                        TYPE_ORDER.indexOf(a.data.type) - TYPE_ORDER.indexOf(b.data.type) ||
                        dnsRecordText(a.data).localeCompare(dnsRecordText(b.data), undefined, { numeric: true }),
                );
            // A name without a record is one whose records were all removed: nothing answers for it.
            if (records.length === 0) continue;
            nodes.push({ guid: guidOf(node), name, fqdn, protected: protectedNode, records });
        }
        nodes.sort((a, b) => Number(b.name === "@") - Number(a.name === "@") || a.name.localeCompare(b.name));

        return {
            ...this.zoneOf(entry, partition, apex, nodes.filter((node) => node.name !== "@").length),
            nodes,
        };
    }

    // ── Changing ─────────────────────────────────────────────────────────────

    /**
     * Raises the serial number of a zone by one and returns the new number.
     *
     * A secondary name server transfers a zone only when its serial number has risen, so
     * every change to what the zone says has to come with this -- before the change, not
     * after: a change that fails leaves a number that was raised for nothing, which costs a
     * secondary one transfer. The other order would leave a change no secondary ever sees.
     *
     * The domain controller's own DNS server raises the same number for every dynamic
     * update. So the SOA record is not written over: the value that was read is taken out
     * and the new one put in, in one request, which the directory refuses when the value
     * has changed in between. Then it is read again.
     */
    private async raiseSerial(zoneDn: string, zoneName: string): Promise<number> {
        const apexDn = `DC=@,${zoneDn}`;
        for (let attempt = 1; ; attempt++) {
            const apex = await this.ldap.read(apexDn, ["dnsRecord"], { explicitBufferAttributes: BINARY });
            const soa = apex && recordsOf(apex).find((record) => record.data.type === "SOA");
            if (!soa || soa.data.type !== "SOA") {
                throw new DirectoryError("failed", `The zone ${zoneName} has no SOA record, so its serial number cannot be raised`);
            }
            const serial = nextSerial(soa.data.serial);
            const raised = encodeDnsRecord({ ...soa.head, serial, timestamp: 0 }, { ...soa.data, serial });
            try {
                await this.ldap.modify(apexDn, [
                    deleteValues("dnsRecord", [Buffer.from(soa.bytes)]),
                    addValues("dnsRecord", [Buffer.from(raised)]),
                ]);
                return serial;
            } catch (err) {
                if (ldapCode(err) !== NO_SUCH_ATTRIBUTE || attempt >= SERIAL_ATTEMPTS) throw directoryError(err, "zone");
            }
        }
    }

    /** The name a GUID names, if it is a name of this zone; a `not-found` refusal otherwise. */
    private async nodeByGuid(zoneDn: string, guid: string): Promise<Entry> {
        let entry: Entry | null;
        try {
            entry = await this.ldap.read(guidDn(guid), ["objectGUID", "objectClass", "name", "dnsRecord", "dNSTombstoned"], {
                explicitBufferAttributes: BINARY,
            });
        } catch (err) {
            throw directoryError(err, "name");
        }
        const isNode = !!entry && attrs(entry, "objectClass").some((name) => name.toLowerCase() === "dnsnode");
        const inZone = !!entry && isDnWithin(entry.dn, zoneDn) && entry.dn.length > zoneDn.length;
        if (!entry || !isNode || !inZone || isTombstoned(entry)) throw notFound("name");
        return entry;
    }

    /** The node of a name in a zone, tombstoned or not; null where there is none. */
    private async nodeByName(zoneDn: string, name: string): Promise<Entry | null> {
        const [entry] = await this.searchBase(zoneDn, {
            scope: "one",
            filter: `(&(objectClass=dnsNode)(name=${escapeFilterValue(name)}))`,
            attributes: ["objectGUID", "name", "dnsRecord", "dNSTombstoned"],
            explicitBufferAttributes: BINARY,
        });
        return entry ?? null;
    }

    private changed(zoneName: string, node: { dn: string; name: string }, data: DnsRecordData, was?: DnsRecordData): DnsChanged {
        return {
            name: dnsFqdn(node.name, zoneName),
            dn: node.dn,
            type: "dns-record",
            zone: zoneName,
            record: describe(data),
            ...(was ? { was: describe(was) } : {}),
        };
    }

    /** A record as it is written, or a refusal for what does not fit one. */
    private encode(serial: number, ttl: number, data: DnsRecordData): Buffer {
        try {
            return Buffer.from(encodeDnsRecord(staticHead(serial, ttl), data));
        } catch (err) {
            if (err instanceof RangeError) throw new DirectoryError("invalid", err.message);
            throw err;
        }
    }

    /** A new record, under a name of the zone that may be new too. */
    async createRecord({ zoneGuid, name, record, ttl }: { zoneGuid: string; name: string; record: DnsRecordData; ttl: number }): Promise<DnsChanged> {
        this.assertWritable();
        const { entry: zone } = await this.zoneEntry(zoneGuid);
        const zoneName = attr(zone, "name") ?? "";
        if (name === "@" || isProtectedNode(zoneName, name)) {
            throw new DirectoryError("forbidden", `${dnsFqdn(name, zoneName)} is a name the domain controllers keep; nothing is added there from here`);
        }
        const fqdn = dnsFqdn(name, zoneName);
        const dcs = await this.domainControllers();
        if (isProtectedRecord(fqdn, record, dcs.hostNames)) {
            throw new DirectoryError("forbidden", `${fqdn} is a domain controller; its addresses are its own to register`);
        }

        const node = await this.nodeByName(zone.dn, name);
        const alive = node && !isTombstoned(node) ? recordsOf(node) : [];
        const conflict = dnsRecordConflict(alive.map(({ data }) => data), record);
        if (conflict) throw new DirectoryError("conflict", conflict);

        const dn = node?.dn ?? `DC=${escapeRdnValue(name)},${zone.dn}`;
        const value = this.encode(await this.raiseSerial(zone.dn, zoneName), ttl, record);
        try {
            if (!node) {
                await this.ldap.add(dn, { objectClass: ["top", "dnsNode"], dnsRecord: value });
            } else if (isTombstoned(node) || alive.length === 0) {
                // A name that was deleted, kept until the directory forgets it: it comes back with this one record.
                await this.ldap.modify(dn, [replace("dnsRecord", [value]), replace("dNSTombstoned", ["FALSE"])]);
            } else {
                await this.ldap.modify(dn, [addValues("dnsRecord", [value])]);
            }
        } catch (err) {
            throw directoryError(err, "name");
        }
        return this.changed(zoneName, { dn, name }, record);
    }

    /** The record of a name that says what `old` says; a `not-found` refusal when there is none (any more). */
    private find(node: Entry, old: DnsRecordData): { record: LiveRecord; all: LiveRecord[] } {
        const all = recordsOf(node);
        const record = all.find(({ data }) => sameDnsRecord(data, old));
        if (!record) throw new DirectoryError("not-found", "The record does not exist (any more): it was changed or deleted meanwhile");
        return { record, all };
    }

    /** One record of a name replaced by another of the same type. */
    async updateRecord({
        zoneGuid,
        nodeGuid,
        old,
        record,
        ttl,
    }: {
        zoneGuid: string;
        nodeGuid: string;
        old: DnsRecordData;
        record: DnsRecordData;
        ttl: number;
    }): Promise<DnsChanged> {
        this.assertWritable();
        const { entry: zone } = await this.zoneEntry(zoneGuid);
        const zoneName = attr(zone, "name") ?? "";
        const node = await this.nodeByGuid(zone.dn, nodeGuid);
        const name = attr(node, "name") ?? "";
        const fqdn = dnsFqdn(name, zoneName);
        const { record: existing, all } = this.find(node, old);

        if (!isManagedDnsType(existing.data.type) || existing.data.type !== record.type) {
            throw new DirectoryError("invalid", "A record keeps its type, and only a type that can be entered here is changed");
        }
        const dcs = await this.domainControllers();
        if (isProtectedNode(zoneName, name) || isProtectedRecord(fqdn, existing.data, dcs.hostNames) || isProtectedRecord(fqdn, record, dcs.hostNames)) {
            throw new DirectoryError("forbidden", `${fqdn} holds records a domain controller registered for itself; they are not changed from here`);
        }
        const conflict = dnsRecordConflict(all.map(({ data }) => data), record, existing.data);
        if (conflict) throw new DirectoryError("conflict", conflict);
        if (sameDnsRecord(existing.data, record) && existing.head.ttl === ttl && existing.head.timestamp === 0) {
            // Nothing to write, and no reason to have every secondary transfer the zone.
            return { ...this.changed(zoneName, { dn: node.dn, name }, record, existing.data), unchanged: true };
        }

        const value = this.encode(await this.raiseSerial(zone.dn, zoneName), ttl, record);
        try {
            await this.ldap.modify(node.dn, [deleteValues("dnsRecord", [Buffer.from(existing.bytes)]), addValues("dnsRecord", [value])]);
        } catch (err) {
            if (ldapCode(err) === NO_SUCH_ATTRIBUTE) {
                throw new DirectoryError("conflict", "The record was changed by somebody else meanwhile; nothing was written");
            }
            throw directoryError(err, "name");
        }
        return this.changed(zoneName, { dn: node.dn, name }, record, existing.data);
    }

    /** One record of a name removed, and the name with it when it was the last. */
    async deleteRecord({ zoneGuid, nodeGuid, record: old }: { zoneGuid: string; nodeGuid: string; record: DnsRecordData }): Promise<DnsChanged> {
        this.assertWritable();
        const { entry: zone } = await this.zoneEntry(zoneGuid);
        const zoneName = attr(zone, "name") ?? "";
        const node = await this.nodeByGuid(zone.dn, nodeGuid);
        const name = attr(node, "name") ?? "";
        const fqdn = dnsFqdn(name, zoneName);
        const { record: existing, all } = this.find(node, old);

        if (!isDeletableRecord(zoneName, name, fqdn, existing.data, await this.domainControllers())) {
            throw new DirectoryError(
                "forbidden",
                `${fqdn} ${describe(existing.data)} is protected: a zone's own records and the ones a domain controller registered for itself are not deleted from here`,
            );
        }

        await this.raiseSerial(zone.dn, zoneName);
        try {
            // Every value of the attribute, not only the ones that read as records: a name is not removed over one this server does not understand.
            if (all.length === 1 && attrBytesAll(node, "dnsRecord").length === 1) {
                await this.ldap.del(node.dn);
            } else {
                await this.ldap.modify(node.dn, [deleteValues("dnsRecord", [Buffer.from(existing.bytes)])]);
            }
        } catch (err) {
            if (ldapCode(err) === NO_SUCH_ATTRIBUTE) {
                throw new DirectoryError("conflict", "The record was changed by somebody else meanwhile; nothing was deleted");
            }
            throw directoryError(err, "name");
        }
        return this.changed(zoneName, { dn: node.dn, name }, existing.data);
    }
}
