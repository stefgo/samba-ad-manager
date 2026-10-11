import type { Entry } from "ldapts";
import {
    dnsFqdn,
    dnsRecordText,
    guidDn,
    guidFromBytes,
    isDnWithin,
    type DnsNode,
    type DnsRecord,
    type DnsRecordData,
    type DnsZone,
    type DnsZoneDetail,
    type DnsZonePartition,
    type DnsZoneSoa,
} from "@sadm/shared";
import { attr, attrBytes, attrBytesAll, attrs, ldapCode, type DcLdap } from "../dc/DcLdap.js";
import { DirectoryError } from "../directory/DirectoryError.js";
import { directoryError, notFound } from "../directory/DirectoryOperations.js";
import { dcHostNameSet, isProtectedNode, isProtectedRecord } from "./dnsProtection.js";
import { decodeDnsRecord, isoOfDnsTimestamp, type DnsRecordHead } from "./dnsRecord.js";

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
}

/** The records of a node that are records: what does not decode is left out, and so is a tombstone. */
function recordsOf(entry: Entry): LiveRecord[] {
    return attrBytesAll(entry, "dnsRecord").flatMap((bytes) => {
        const record = decodeDnsRecord(bytes);
        return record && record.data.type !== "tombstone" ? [{ head: record.head, data: record.data }] : [];
    });
}

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

    constructor(private readonly ldap: DcLdap) {}

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

    /** The host names of the domain controllers: the names whose addresses are theirs to keep. */
    private async dcHostNames(): Promise<ReadonlySet<string>> {
        const root = await this.ldap.read("", ["defaultNamingContext"]);
        const domainDn = attr(root, "defaultNamingContext");
        if (!domainDn) return new Set();
        // 8192 is SERVER_TRUST_ACCOUNT: the account of a domain controller.
        const entries = await this.ldap.search(domainDn, {
            scope: "sub",
            filter: "(&(objectCategory=computer)(userAccountControl:1.2.840.113556.1.4.803:=8192))",
            attributes: ["dNSHostName"],
        });
        return dcHostNameSet(entries.map((entry) => attr(entry, "dNSHostName")));
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
    async zoneHeads(): Promise<Pick<DnsZone, "name" | "soa" | "nameServers">[]> {
        const heads: Pick<DnsZone, "name" | "soa" | "nameServers">[] = [];
        for (const base of await this.bases()) {
            for (const entry of await this.zoneEntries(base)) {
                const { name, soa, nameServers } = this.zoneOf(entry, base.partition, await this.apexOf(entry.dn), 0);
                heads.push({ name, soa, nameServers });
            }
        }
        return heads.sort((a, b) => a.name.localeCompare(b.name));
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
        const [entries, dcHosts] = await Promise.all([
            this.searchBase(entry.dn, {
                scope: "one",
                filter: "(objectClass=dnsNode)",
                attributes: ["objectGUID", "name", "dnsRecord", "dNSTombstoned"],
                explicitBufferAttributes: BINARY,
            }),
            this.dcHostNames(),
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
                    protected: protectedNode || isProtectedRecord(fqdn, data, dcHosts),
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
}
