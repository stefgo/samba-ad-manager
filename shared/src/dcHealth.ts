import { z } from "zod";

/**
 * What an agent measures on its domain controller, and what the server makes of it.
 *
 * Every part of a measurement may be missing on its own: LDAP may not answer while the
 * container still runs, replication is read less often than the rest. A part that could not
 * be read is `null` and says why in `errors` -- it is not an empty list, which would read as
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
 * The services a domain controller answers on. `required` ones make it one; the others are
 * worth knowing about but a DC without them still serves the directory.
 */
export const DC_PORTS = [
    { name: "DNS", port: 53, required: true },
    { name: "Kerberos", port: 88, required: true },
    { name: "RPC endpoint mapper", port: 135, required: true },
    { name: "LDAP", port: 389, required: true },
    { name: "SMB", port: 445, required: true },
    { name: "Kerberos password change", port: 464, required: false },
    { name: "LDAPS", port: 636, required: true },
    { name: "Global catalog", port: 3268, required: false },
] as const;

/** The Samba container, as the Docker API describes it. */
export const DcContainerSchema = z.looseObject({
    name: z.string(),
    /** Docker's word: `running`, `exited`, `restarting`, … */
    state: z.string(),
    running: z.boolean(),
    startedAt: z.string().nullish(),
    image: z.string().nullish(),
    /** The container's own HEALTHCHECK, if its image has one: `healthy`, `unhealthy`, `starting`. */
    health: z.string().nullish(),
    restartCount: z.number().int().nullish(),
});

/** Who the domain controller is, from its rootDSE. */
export const DcIdentitySchema = z.looseObject({
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

/** One domain controller as the directory lists it, whether or not an agent stands next to it. */
export const DirectoryDcSchema = z.looseObject({
    name: z.string(),
    dnsHostName: z.string().nullish(),
    site: z.string().nullish(),
    isGlobalCatalog: z.boolean().nullish(),
});

/** The domain as this domain controller sees it. */
export const DcDomainViewSchema = z.looseObject({
    /** `DC=sadm,DC=test` */
    dn: z.string(),
    /** `sadm.test` */
    dnsName: z.string(),
    domainLevel: z.number().int().nullish(),
    forestLevel: z.number().int().nullish(),
    /** The name of the domain controller holding each role, or null where none is named. */
    fsmo: z.record(z.string(), z.string().nullable()),
    controllers: z.array(DirectoryDcSchema).default([]),
    /** How many of each there are, by a count over the directory. */
    counts: z
        .looseObject({
            users: z.number().int(),
            groups: z.number().int(),
            computers: z.number().int(),
        })
        .nullish(),
});

/** One replication link of one naming context. */
export const ReplicationNeighbourSchema = z.looseObject({
    namingContext: z.string(),
    /** The partner's name, read off its NTDS settings DN; the DN itself where that fails. */
    partner: z.string(),
    partnerSite: z.string().nullish(),
    /** ISO time; null when the link has never been tried. */
    lastAttempt: z.string().nullable(),
    lastSuccess: z.string().nullable(),
    consecutiveFailures: z.number().int(),
    /** The Windows error code of the last attempt; 0 is success. */
    resultCode: z.number().int(),
    resultText: z.string().nullish(),
});

export const DcReplicationSchema = z.looseObject({
    collectedAt: z.string(),
    inbound: z.array(ReplicationNeighbourSchema).default([]),
    outbound: z.array(ReplicationNeighbourSchema).default([]),
});

/** One Samba service with the processes behind it. */
export const DcProcessSchema = z.looseObject({
    name: z.string(),
    pids: z.array(z.number().int()).default([]),
});

export const DcPortSchema = z.looseObject({
    name: z.string(),
    port: z.number().int(),
    open: z.boolean(),
});

/** The last run of the database check. */
export const DcDbcheckSchema = z.looseObject({
    checkedAt: z.string(),
    /** How many errors the check counted; null when the check itself failed. */
    errors: z.number().int().nullable(),
    durationMs: z.number().nullish(),
    error: z.string().nullish(),
});

/** Why a part of the measurement is missing. */
export const DcHealthErrorSchema = z.looseObject({
    /** Which part: `container`, `ldap`, `replication`, `processes`, `dbcheck`, … */
    source: z.string(),
    message: z.string(),
});

/**
 * `DC_HEALTH`: one measurement, as the agent sends it. Loose, like every agent payload: a
 * newer agent that reports more must not be dropped.
 */
export const DcHealthReportSchema = z.looseObject({
    collectedAt: z.string().min(1),
    container: DcContainerSchema.nullish(),
    identity: DcIdentitySchema.nullish(),
    domain: DcDomainViewSchema.nullish(),
    replication: DcReplicationSchema.nullish(),
    processes: z.array(DcProcessSchema).nullish(),
    ports: z.array(DcPortSchema).nullish(),
    dbcheck: DcDbcheckSchema.nullish(),
    errors: z.array(DcHealthErrorSchema).default([]),
});

/**
 * `DC_HEALTH_UPDATE`: a client's last measurement together with when the server received
 * it, and how far the domain controller's clock was from the server's at that moment.
 */
export const DcHealthSchema = DcHealthReportSchema.extend({
    clientId: z.string().min(1),
    receivedAt: z.string().min(1),
    /**
     * The domain controller's name in the directory, as the last measurement that could read
     * it gave it. Kept by the server across measurements: while Samba is down the agent
     * cannot ask who it stands next to, and that is exactly when the name is needed to tell
     * which of the directory's domain controllers is the one in trouble.
     */
    dcName: z.string().nullish(),
    /**
     * The agent's clock minus the server's when the measurement arrived, in milliseconds.
     * The agent shares its host's clock with the Samba container, so this is the domain
     * controller's offset -- what Kerberos tolerates five minutes of.
     */
    clockOffsetMs: z.number().nullish(),
});

export type DcContainer = z.infer<typeof DcContainerSchema>;
export type DcIdentity = z.infer<typeof DcIdentitySchema>;
export type DirectoryDc = z.infer<typeof DirectoryDcSchema>;
export type DcDomainView = z.infer<typeof DcDomainViewSchema>;
export type ReplicationNeighbour = z.infer<typeof ReplicationNeighbourSchema>;
export type DcReplication = z.infer<typeof DcReplicationSchema>;
export type DcProcess = z.infer<typeof DcProcessSchema>;
export type DcPort = z.infer<typeof DcPortSchema>;
export type DcDbcheck = z.infer<typeof DcDbcheckSchema>;
export type DcHealthReport = z.infer<typeof DcHealthReportSchema>;
export type DcHealth = z.infer<typeof DcHealthSchema>;
