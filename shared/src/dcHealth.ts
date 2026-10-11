import { z } from "zod";
import { GuidSchema } from "./directory.js";

/**
 * What the server measures on a domain controller, over the network.
 *
 * Every part of a measurement may be missing on its own: the directory may not answer while
 * DNS still does, replication is read less often than the rest. A part that could not be
 * read is `null` and says why in `errors` -- it is not an empty list, which would read as
 * "nothing is wrong".
 */

/** The seven FSMO roles of a forest, as `samba-tool fsmo show` lists them. */
export const FSMO_ROLES = [
    "schema",
    "naming",
    "pdc",
    "rid",
    "infrastructure",
    "domainDns",
    "forestDns",
] as const;

export type FsmoRole = (typeof FSMO_ROLES)[number];

/** The roles as a reader sees them. */
export const FSMO_ROLE_LABELS: Record<FsmoRole, string> = {
    schema: "Schema master",
    naming: "Domain naming master",
    pdc: "PDC emulator",
    rid: "RID master",
    infrastructure: "Infrastructure master",
    domainDns: "Domain DNS zone master",
    forestDns: "Forest DNS zone master",
};

/**
 * How a service is asked whether it is there. `protocol` puts a real question to it and
 * reads the answer; `connect` only opens the port. A process that hangs keeps its port
 * open, so only `protocol` notices it -- which is why the services a domain controller
 * cannot do without are asked that way wherever this server speaks their protocol.
 */
export const DC_SERVICE_CHECKS = ["protocol", "connect"] as const;
export type DcServiceCheck = (typeof DC_SERVICE_CHECKS)[number];

/**
 * The services a domain controller answers on. `required` ones make it one; the others are
 * worth knowing about but a DC without them still serves the directory.
 */
export const DC_SERVICES = [
    { name: "DNS", port: 53, required: true, check: "protocol" },
    { name: "Kerberos", port: 88, required: true, check: "protocol" },
    { name: "RPC endpoint mapper", port: 135, required: true, check: "connect" },
    { name: "LDAP", port: 389, required: true, check: "connect" },
    { name: "SMB", port: 445, required: true, check: "connect" },
    { name: "Kerberos password change", port: 464, required: false, check: "connect" },
    { name: "LDAPS", port: 636, required: true, check: "protocol" },
    { name: "Global catalog", port: 3268, required: false, check: "connect" },
] as const satisfies readonly { name: string; port: number; required: boolean; check: DcServiceCheck }[];

/** One service of a domain controller, as the last measurement found it. */
export const DcServiceSchema = z.object({
    name: z.string(),
    port: z.number().int(),
    check: z.enum(DC_SERVICE_CHECKS),
    ok: z.boolean(),
    /** Why it is not: `timed out`, `connection refused`, what the service answered instead. */
    detail: z.string().nullish(),
    /** How long the answer took; null without one. */
    latencyMs: z.number().nullish(),
});

/** Who the domain controller is, from its rootDSE. */
export const DcIdentitySchema = z.object({
    /** The server's name in the directory: `DC1`. */
    name: z.string(),
    dnsHostName: z.string().nullish(),
    site: z.string().nullish(),
    sambaVersion: z.string().nullish(),
    isGlobalCatalog: z.boolean().nullish(),
    /** Whether the DC says it has finished its initial replication. */
    isSynchronized: z.boolean().nullish(),
    highestCommittedUsn: z.string().nullish(),
});

/** One domain controller as the directory lists it. */
export const DirectoryDcSchema = z.object({
    /** The `objectGUID` of its NTDS settings: what replication names a partner by. */
    id: GuidSchema,
    name: z.string(),
    dnsHostName: z.string().nullish(),
    site: z.string().nullish(),
    isGlobalCatalog: z.boolean().nullish(),
    /** A read-only domain controller, which registers fewer DNS records than a writable one. */
    isReadOnly: z.boolean().nullish(),
    /** Whether it holds the DNS partition of the domain, and of the forest: whether it is a DNS server for them. */
    holdsDomainDns: z.boolean().nullish(),
    holdsForestDns: z.boolean().nullish(),
});

/** The domain as this domain controller sees it. */
export const DcDomainViewSchema = z.object({
    /** `DC=sadm,DC=test` */
    dn: z.string(),
    /** `sadm.test` */
    dnsName: z.string(),
    /** The DNS name of the forest's root domain; the same as `dnsName` in a forest of one domain. */
    forestDnsName: z.string().nullish(),
    /** The `objectGUID` of the domain: one of the names a domain controller registers carries it. */
    domainGuid: z.string().nullish(),
    domainLevel: z.number().int().nullish(),
    forestLevel: z.number().int().nullish(),
    /** The name of the domain controller holding each role, or null where none is named. */
    fsmo: z.record(z.string(), z.string().nullable()),
    controllers: z.array(DirectoryDcSchema),
    /** How many of each there are, by a count over the directory. */
    counts: z
        .object({
            users: z.number().int(),
            groups: z.number().int(),
            computers: z.number().int(),
        })
        .nullish(),
});

/** One replication link of one naming context. */
export const ReplicationNeighbourSchema = z.object({
    namingContext: z.string(),
    /** The partner's name in the directory; its GUID where the directory lists no such DC. */
    partner: z.string(),
    partnerSite: z.string().nullish(),
    /** ISO time; null when the link has never been tried, or for a link that keeps no time. */
    lastAttempt: z.string().nullable(),
    lastSuccess: z.string().nullable(),
    consecutiveFailures: z.number().int(),
    /** The Windows error code of the last attempt; 0 is success. */
    resultCode: z.number().int(),
    resultText: z.string().nullish(),
});

/**
 * The replication links of a domain controller, read from `repsFrom` and `repsTo` on each
 * naming context. Samba keeps the times of a link on its inbound side only: an outbound
 * link names the partner that is told about changes, and whether that partner is up to
 * date is what its own inbound link says.
 */
export const DcReplicationSchema = z.object({
    collectedAt: z.string(),
    inbound: z.array(ReplicationNeighbourSchema),
    outbound: z.array(ReplicationNeighbourSchema),
});

/**
 * `POST /api/v1/dbcheck/report`: what the script on a domain controller sends after a run
 * of Samba's database check. The one thing the server cannot read over the network.
 */
export const DbcheckReportSchema = z.object({
    /** The domain controller's own id, as it reads it from its database. */
    dcId: GuidSchema,
    /** When the check finished, by the domain controller's clock. */
    checkedAt: z.iso.datetime({ offset: true }),
    /** How many errors the check counted; null when the check itself failed. */
    errors: z.number().int().min(0).nullable(),
    durationMs: z.number().min(0).nullish(),
    /** Why there is no count. */
    error: z.string().max(2000).nullish(),
});

/** The last database check a domain controller reported, and when the report arrived. */
export const DcDbcheckSchema = DbcheckReportSchema.omit({ dcId: true }).extend({
    checkedAt: z.string(),
    receivedAt: z.string(),
});

/** What one name server answered when it was asked for the SOA record of one zone. */
const ZoneAnswerSchema = z.object({
    zone: z.string(),
    /** Whether it answered for the zone with authority -- as a server that holds it, not one that looked it up. */
    ok: z.boolean(),
    /** Why not: `timed out`, `not authoritative`, the code it answered with. */
    detail: z.string().nullish(),
    /** The zone's serial number as this server serves it. */
    serial: z.number().int().nullish(),
    /** How often a secondary asks whether the zone has changed, and how soon it asks again when that fails. Seconds. */
    refresh: z.number().int().nullish(),
    retry: z.number().int().nullish(),
});

/**
 * The DNS zones of the directory as one domain controller's DNS server answers for them:
 * every zone its directory holds, asked for over DNS. Read as often as replication is.
 */
export const DcDnsSchema = z.object({
    collectedAt: z.string(),
    zones: z.array(
        ZoneAnswerSchema.extend({
            /** The name servers the zone lists, as this domain controller's directory has them. */
            nameServers: z.array(z.string()),
        }),
    ),
});

/**
 * The DNS records the domain controllers register for themselves, as the directory of one
 * domain controller has them: what `expectedDcRecords` lists for each, and which of it is
 * missing. Read as often as replication is.
 */
export const DcDnsRecordsSchema = z.object({
    collectedAt: z.string(),
    controllers: z.array(
        z.object({
            /** The domain controller the records are of -- any of the domain, not only the one that was asked. */
            dcId: z.string(),
            name: z.string(),
            /** How many records it should have. */
            expected: z.number().int(),
            missing: z.array(
                z.object({
                    /** The record as a reader is told: `SRV _ldap._tcp.sadm.test (port 389)`. */
                    record: z.string(),
                    /** Without it the domain controller is not found. */
                    essential: z.boolean(),
                }),
            ),
        }),
    ),
    /** Records under the domain controllers' names that name a host, or an address, that is no domain controller's. */
    stale: z.array(z.object({ target: z.string(), type: z.string(), name: z.string() })),
});

/**
 * A name server of the domain that is no domain controller: a secondary that transfers a
 * zone from one. The directory knows of it only as a name in a zone's NS records, or not at
 * all -- then `health.dnsServers` names it.
 */
export const DnsServerHealthSchema = z.object({
    /** The host name as the zone or the configuration gives it, lower case. */
    name: z.string(),
    /** Where it was asked; null when the name does not resolve. */
    address: z.string().nullable(),
    /** `ns`: a zone lists it as a name server. `config`: only `health.dnsServers` does. */
    source: z.enum(["ns", "config"]),
    collectedAt: z.string(),
    /** Whether it answered at all. */
    ok: z.boolean(),
    detail: z.string().nullish(),
    /**
     * The zones it is expected to answer for: every zone that lists it, and for a server
     * from the configuration every zone it does answer for.
     */
    zones: z.array(
        ZoneAnswerSchema.extend({
            /** The highest serial number a domain controller served for the zone when this was measured. */
            referenceSerial: z.number().int().nullish(),
            /**
             * Since when this server has had a serial number other than the domain
             * controllers' without its own having moved; null while it is in step, or
             * catching up.
             */
            outOfSyncSince: z.string().nullish(),
        }),
    ),
});

/** Why a part of the measurement is missing. */
export const DcHealthErrorSchema = z.object({
    /** Which part: `directory`, `replication`, `counts`, `dns`, `dns-records`. */
    source: z.string(),
    message: z.string(),
});

/** One measurement of one domain controller. */
export const DcMeasurementSchema = z.object({
    collectedAt: z.string().min(1),
    identity: DcIdentitySchema.nullish(),
    domain: DcDomainViewSchema.nullish(),
    replication: DcReplicationSchema.nullish(),
    dns: DcDnsSchema.nullish(),
    dcRecords: DcDnsRecordsSchema.nullish(),
    services: z.array(DcServiceSchema),
    /**
     * The domain controller's clock minus this server's, in milliseconds, from the
     * `currentTime` of its rootDSE. Whole seconds, which is plenty for what Kerberos
     * tolerates five minutes of. Null while the directory does not answer.
     */
    clockOffsetMs: z.number().nullish(),
    errors: z.array(DcHealthErrorSchema),
});

/**
 * `DC_HEALTH_UPDATE` and one entry of `GET /api/v1/dc-health`: the last measurement of a
 * domain controller together with the last database check it reported.
 */
export const DcHealthSchema = DcMeasurementSchema.extend({
    dcId: z.string().min(1),
    dbcheck: DcDbcheckSchema.nullish(),
});

export type DcService = z.infer<typeof DcServiceSchema>;
export type DcIdentity = z.infer<typeof DcIdentitySchema>;
export type DirectoryDc = z.infer<typeof DirectoryDcSchema>;
export type DcDomainView = z.infer<typeof DcDomainViewSchema>;
export type ReplicationNeighbour = z.infer<typeof ReplicationNeighbourSchema>;
export type DcReplication = z.infer<typeof DcReplicationSchema>;
export type DcDns = z.infer<typeof DcDnsSchema>;
export type DcDnsRecords = z.infer<typeof DcDnsRecordsSchema>;
export type DnsServerHealth = z.infer<typeof DnsServerHealthSchema>;
export type DbcheckReport = z.infer<typeof DbcheckReportSchema>;
export type DcDbcheck = z.infer<typeof DcDbcheckSchema>;
export type DcMeasurement = z.infer<typeof DcMeasurementSchema>;
export type DcHealth = z.infer<typeof DcHealthSchema>;
