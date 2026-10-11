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
    /**
     * Whether the record can be deleted. Every record that is not protected can -- and so
     * can a protected one that names no domain controller (any more): what a demotion left
     * behind, which nothing else would ever remove.
     */
    deletable: z.boolean().default(true),
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

// ── What a change to a zone is asked with ────────────────────────────────────

/** The types a record can be entered as. NS and SOA are the zone's own and are not changed from here. */
export const DNS_MANAGED_TYPES = ["A", "AAAA", "CNAME", "PTR", "TXT", "MX", "SRV"] as const;
export type DnsManagedType = (typeof DNS_MANAGED_TYPES)[number];

export const isManagedDnsType = (type: string): type is DnsManagedType => (DNS_MANAGED_TYPES as readonly string[]).includes(type);

/** The TTL a new record starts with: what `samba-tool` gives one. */
export const DEFAULT_DNS_TTL = 900;

const LABEL = /^(?!-)[A-Za-z0-9_-]{1,63}(?<!-)$/;

/** A host name: labels of letters, digits, hyphens and underscores, at most 253 characters, the dot at its end dropped. */
const HostNameSchema = z
    .string()
    .trim()
    .transform((name) => name.replace(/\.$/, ""))
    .refine((name) => name.length >= 1 && name.length <= 253 && name.split(".").every((label) => LABEL.test(label)), {
        error: "Must be a host name",
    });

/**
 * A name within a zone: `www`, `a.b`, `*` for everything that has no name of its own. Not
 * `@` -- the zone's own records are not changed from here -- and no dot at either end: the
 * zone's name is not part of it.
 */
export const DnsNodeNameSchema = z
    .string()
    .trim()
    .refine(
        (name) =>
            name.length >= 1 &&
            name.length <= 253 &&
            name.split(".").every((label, index) => LABEL.test(label) || (index === 0 && label === "*")),
        { error: "Must be a name within the zone: letters, digits, hyphens and dots" },
    );

const Uint16Schema = z.number().int().min(0).max(65535);

/** A text of a TXT record: at most 255 bytes, which is not the same as 255 characters. */
const TxtStringSchema = z.string().refine((text) => new TextEncoder().encode(text).length <= 255, {
    error: "At most 255 bytes per text",
});

/** A record as it is entered: one of the managed types, with what it says checked. */
export const DnsRecordInputSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("A"), address: z.ipv4({ error: "Must be an IPv4 address" }) }),
    z.object({ type: z.literal("AAAA"), address: z.ipv6({ error: "Must be an IPv6 address" }) }),
    z.object({ type: z.literal("CNAME"), target: HostNameSchema }),
    z.object({ type: z.literal("PTR"), target: HostNameSchema }),
    z.object({ type: z.literal("TXT"), strings: z.array(TxtStringSchema).min(1, "At least one text").max(64) }),
    z.object({ type: z.literal("MX"), preference: Uint16Schema, exchange: HostNameSchema }),
    z.object({ type: z.literal("SRV"), priority: Uint16Schema, weight: Uint16Schema, port: Uint16Schema, target: HostNameSchema }),
]);

export type DnsRecordInput = z.infer<typeof DnsRecordInputSchema>;

const TtlSchema = z.number().int().min(0).max(2147483647);

/** `POST /api/v1/dns/zones/:guid/records`: a new record, under a name that may be new too. */
export const CreateDnsRecordSchema = z.object({
    name: DnsNodeNameSchema,
    record: DnsRecordInputSchema,
    ttl: TtlSchema.default(DEFAULT_DNS_TTL),
});

/**
 * `PUT /api/v1/dns/zones/:guid/nodes/:nodeGuid/records`: one record of a name replaced by
 * another of the same type. `old` says which: a record has no id, so it is named by what
 * it says, as it was read.
 */
export const UpdateDnsRecordSchema = z
    .object({
        old: DnsRecordDataSchema,
        record: DnsRecordInputSchema,
        ttl: TtlSchema,
    })
    .refine((input) => input.old.type === input.record.type, { error: "A record keeps its type", path: ["record", "type"] });

/** `POST /api/v1/dns/zones/:guid/nodes/:nodeGuid/records/delete`: one record of a name removed. */
export const DeleteDnsRecordSchema = z.object({ record: DnsRecordDataSchema });

export type CreateDnsRecord = z.input<typeof CreateDnsRecordSchema>;
export type UpdateDnsRecord = z.input<typeof UpdateDnsRecordSchema>;
export type DeleteDnsRecord = z.input<typeof DeleteDnsRecordSchema>;

/**
 * Whether two records say the same. Names are compared without their case and without a
 * dot at their end -- DNS does not tell them apart -- and so are addresses, which the
 * directory hands back in one spelling whatever was entered.
 */
export function sameDnsRecord(a: DnsRecordData, b: DnsRecordData): boolean {
    const name = (value: string) => value.toLowerCase().replace(/\.$/, "");
    switch (a.type) {
        case "A":
        case "AAAA":
            return b.type === a.type && name(a.address) === name(b.address);
        case "CNAME":
        case "PTR":
        case "NS":
            return b.type === a.type && name(a.target) === name(b.target);
        case "TXT":
            return b.type === "TXT" && a.strings.length === b.strings.length && a.strings.every((text, index) => text === b.strings[index]);
        case "MX":
            return b.type === "MX" && a.preference === b.preference && name(a.exchange) === name(b.exchange);
        case "SRV":
            return (
                b.type === "SRV" && a.priority === b.priority && a.weight === b.weight && a.port === b.port && name(a.target) === name(b.target)
            );
        case "SOA":
            return b.type === "SOA" && a.serial === b.serial && name(a.primary) === name(b.primary);
        case "other":
            return b.type === "other" && a.typeCode === b.typeCode && a.hex === b.hex;
    }
}

/**
 * Why a record cannot stand next to the ones a name has already; null when it can.
 *
 * - No record twice.
 * - An alias stands alone (RFC 1034): a name that is a CNAME is nothing else, and a name
 *   that is anything else is no CNAME.
 *
 * `replaced` is the record the new one takes the place of, for a change: it does not count
 * among the ones that are there.
 */
export function dnsRecordConflict(existing: readonly DnsRecordData[], adding: DnsRecordData, replaced?: DnsRecordData): string | null {
    const others = replaced ? existing.filter((record) => !sameDnsRecord(record, replaced)) : existing;
    if (others.some((record) => sameDnsRecord(record, adding))) return "The name has this record already";
    if (adding.type === "CNAME" && others.length > 0) {
        return "The name has other records, and an alias (CNAME) stands alone";
    }
    if (adding.type !== "CNAME" && others.some((record) => record.type === "CNAME")) {
        return "The name is an alias (CNAME) and can have no other record";
    }
    return null;
}
