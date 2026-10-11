import { z } from "zod";

/**
 * The DNS zones of the domain as this application shows them.
 *
 * A Samba domain keeps its zones in the directory: a `dnsZone` object per zone, below it a
 * `dnsNode` per name, and on that the records of the name. That is what is read here, over
 * LDAP like everything else -- whichever server answers DNS, Samba's own or BIND, serves
 * what stands there.
 *
 * A zone and a name are addressed by the `objectGUID` of their object. A single record has
 * no id of its own: it is told apart by its type and what it says.
 */

/** The record types this application reads the content of. Any other is shown as `other`. */
export const DNS_RECORD_TYPES = ["A", "AAAA", "CNAME", "PTR", "NS", "TXT", "MX", "SRV", "SOA"] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

/** What a record says, by type. Host names are fully qualified and carry no trailing dot. */
export const DnsRecordDataSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("A"), address: z.string() }),
    z.object({ type: z.literal("AAAA"), address: z.string() }),
    z.object({ type: z.literal("CNAME"), target: z.string() }),
    z.object({ type: z.literal("PTR"), target: z.string() }),
    z.object({ type: z.literal("NS"), target: z.string() }),
    /** The strings of the record, each at most 255 bytes long. */
    z.object({ type: z.literal("TXT"), strings: z.array(z.string()) }),
    z.object({ type: z.literal("MX"), preference: z.number().int(), exchange: z.string() }),
    z.object({
        type: z.literal("SRV"),
        priority: z.number().int(),
        weight: z.number().int(),
        port: z.number().int(),
        target: z.string(),
    }),
    z.object({
        type: z.literal("SOA"),
        serial: z.number().int(),
        refresh: z.number().int(),
        retry: z.number().int(),
        expire: z.number().int(),
        minimum: z.number().int(),
        /** The name server the zone names as its primary. */
        primary: z.string(),
        /** The mailbox of whoever is responsible, in DNS notation: `hostmaster.sadm.test`. */
        mailbox: z.string(),
    }),
    /** A type this application does not read: its number, and its data as it is stored. */
    z.object({ type: z.literal("other"), typeCode: z.number().int(), hex: z.string() }),
]);

export type DnsRecordData = z.infer<typeof DnsRecordDataSchema>;

/** One record of a name. */
export const DnsRecordSchema = z.object({
    data: DnsRecordDataSchema,
    /** Seconds. */
    ttl: z.number().int(),
    /**
     * When a client last registered the record itself, for one that was registered
     * dynamically; null for one somebody entered, which never ages.
     */
    registeredAt: z.string().nullable(),
    /**
     * A record the domain cannot do without -- one a domain controller registered for itself.
     * It can be looked at and is not changed from here.
     */
    protected: z.boolean().default(false),
});

/** One name of a zone, with its records. */
export const DnsNodeSchema = z.object({
    guid: z.string(),
    /** The name within the zone: `www`, `_ldap._tcp`, or `@` for the zone itself. */
    name: z.string(),
    /** The name as DNS answers for it: `www.sadm.test`. */
    fqdn: z.string(),
    /** A name where every record is protected, and none is added. */
    protected: z.boolean().default(false),
    records: z.array(DnsRecordSchema),
});

/**
 * Where a zone is kept. `domain` and `forest` are the two DNS partitions, replicated to the
 * DNS servers of the domain and of the forest; `legacy` is the domain partition itself,
 * where a domain that was upgraded from an old one may still have its zones.
 */
export const DNS_ZONE_PARTITIONS = ["domain", "forest", "legacy"] as const;
export type DnsZonePartition = (typeof DNS_ZONE_PARTITIONS)[number];

/** What a zone says about itself in its SOA record. */
export const DnsZoneSoaSchema = z.object({
    serial: z.number().int(),
    refresh: z.number().int(),
    retry: z.number().int(),
    expire: z.number().int(),
    minimum: z.number().int(),
    primary: z.string(),
    mailbox: z.string(),
});

/** One zone, as the list shows it. */
export const DnsZoneSchema = z.object({
    guid: z.string(),
    name: z.string(),
    dn: z.string(),
    partition: z.enum(DNS_ZONE_PARTITIONS),
    /** Null for a zone without a SOA record, which no server answers for. */
    soa: DnsZoneSoaSchema.nullable(),
    /** The name servers the zone lists. */
    nameServers: z.array(z.string()),
    /** How many names the zone has, the zone itself not counted. */
    nodeCount: z.number().int(),
});

/** One zone with everything in it. */
export const DnsZoneDetailSchema = DnsZoneSchema.extend({
    nodes: z.array(DnsNodeSchema),
});

export type DnsRecord = z.infer<typeof DnsRecordSchema>;
export type DnsNode = z.infer<typeof DnsNodeSchema>;
export type DnsZoneSoa = z.infer<typeof DnsZoneSoaSchema>;
export type DnsZone = z.infer<typeof DnsZoneSchema>;
export type DnsZoneDetail = z.infer<typeof DnsZoneDetailSchema>;

/** `www` in `sadm.test` is `www.sadm.test`; `@` is the zone itself. */
export function dnsFqdn(nodeName: string, zoneName: string): string {
    return nodeName === "@" ? zoneName : `${nodeName}.${zoneName}`;
}

/** What a record says, on one line, the way a zone file would write it. */
export function dnsRecordText(data: DnsRecordData): string {
    switch (data.type) {
        case "A":
        case "AAAA":
            return data.address;
        case "CNAME":
        case "PTR":
        case "NS":
            return data.target;
        case "TXT":
            return data.strings.map((text) => `"${text}"`).join(" ");
        case "MX":
            return `${data.preference} ${data.exchange}`;
        case "SRV":
            return `${data.priority} ${data.weight} ${data.port} ${data.target}`;
        case "SOA":
            return `${data.primary} ${data.mailbox} ${data.serial} ${data.refresh} ${data.retry} ${data.expire} ${data.minimum}`;
        case "other":
            return data.hex;
    }
}

/** The type as a reader sees it: its name, or `TYPE99` for one this application does not know. */
export const dnsRecordTypeLabel = (data: DnsRecordData): string => (data.type === "other" ? `TYPE${data.typeCode}` : data.type);
