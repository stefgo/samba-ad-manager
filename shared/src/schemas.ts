import { z } from "zod";
import { ACTIVITY_LEVELS, WEBHOOK_METHODS } from "./constants.js";
import { placeholderError, webhookTemplateError } from "./webhookTemplate.js";
import { parseLevelOverrides } from "./activityLevelOverrides.js";
import { MAX_AGENT_RETRIES, MAX_AGENT_RETRY_DELAY_MINUTES } from "./agent.js";
import {
    DEFAULT_ISSUE_REPORT_AFTER_MINUTES,
    DEFAULT_ISSUE_RESOLVE_AFTER_MINUTES,
    MAX_ISSUE_WAIT_MINUTES,
    parseIssueTimingOverrides,
} from "./issueTiming.js";
import { DcAgentSchema } from "./agent.js";
import { parseLdapServiceUrl } from "./serviceUrls.js";
import { LogLevelSchema } from "./validation.js";

/**
 * One entry of `security.trusted_proxies`: what Fastify's `trustProxy` (proxy-addr) accepts
 * as a list item. The three names are proxy-addr's presets: `loopback` (127.0.0.1/8, ::1),
 * `linklocal` and `uniquelocal` (the RFC 1918 ranges and fc00::/7, which covers a proxy on
 * a Docker bridge network whose address is not fixed).
 */
export const TrustedProxySchema = z.union(
    [
        z.ipv4(),
        z.cidrv4(),
        z.ipv6(),
        z.cidrv6(),
        z.enum(["loopback", "linklocal", "uniquelocal"]),
    ],
    {
        error: "Must be an IP address, a network in CIDR notation, or one of loopback, linklocal, uniquelocal",
    },
);

/** YAML turns an empty block (`settings:` with nothing below it) into null. */
const blockOrMissing = <T extends z.ZodType>(schema: T) =>
    z.preprocess((value) => value ?? undefined, schema);

/**
 * `ldaps://host[:port]`. LDAPS only -- Samba refuses a simple bind without TLS, and a
 * password set over anything else would travel in the clear.
 */
export const LdapsUrlSchema = z
    .string()
    .trim()
    .regex(/^ldaps:\/\/[^/\s]+$/i, "Must be an ldaps:// URL without a path");

/**
 * `ldap://host[:port]` or `ldaps://host[:port]`: a name applications reach the directory
 * under rather than one domain controller -- that of a virtual address, say. This server
 * measures it and never works through it.
 */
export const LdapServiceUrlSchema = z
    .string()
    .trim()
    .refine((value) => parseLdapServiceUrl(value) !== null, "Must be an ldap:// or ldaps:// URL without a path");

/**
 * The `directory` block of config.yaml: how this server reaches the domain, as which account,
 * and what it may do there.
 *
 * `urls` are where it starts. Every other domain controller is found in the directory those
 * answer with, so one is enough -- a second one is for the day the first is down.
 *
 * The password is not here: it comes from `SADM_LDAP_PASSWORD` or the file named by
 * `SADM_LDAP_PASSWORD_FILE`, so config.yaml can be read without giving the directory away.
 *
 * `enabled` and `readOnly` live in this file and nowhere in the UI on purpose: whoever takes
 * over a login of this application must not be able to switch writing back on.
 */
export const DirectoryConfigSchema = z
    .object({
        urls: z.array(LdapsUrlSchema).default([]),
        /**
         * The names applications reach the directory under, as `ldap://` and `ldaps://` URLs:
         * one name for both or one each, in any domain. Measured, and their host names are
         * accepted in a domain controller's certificate besides its own -- Samba presents one
         * certificate under every name, and one issued for these names does not carry the
         * domain controller's.
         */
        serviceUrls: z.array(LdapServiceUrlSchema).default([]),
        /** The account this server binds as: a DN or `user@realm`. */
        bindDn: z.string().trim().min(1).nullish(),
        /**
         * One PEM file with the CA -- or the certificates themselves -- every domain
         * controller presents. Samba's own self-signed certificates differ per domain
         * controller; they all go into this one file.
         */
        caFile: z.string().trim().min(1).nullish(),
        /** Accept a certificate that does not validate. Off by default. */
        allowSelfSigned: z.boolean().default(false),
        timeoutMs: z.number().int().min(1000).max(120000).default(15000),
        /** Off: the domain controllers are measured, and no question about objects is answered. */
        enabled: z.boolean().default(true),
        /** On: objects can be looked at, and none is created, changed or deleted. */
        readOnly: z.boolean().default(false),
    })
    .prefault({});

/**
 * Where a domain controller is reached when its name in the directory does not resolve from
 * this server: a host name or an IP address, nothing else. It ends up in an `ldaps://` URL
 * and in socket connections, where a scheme, port or path of its own would send them elsewhere.
 */
export const DcAddressSchema = z
    .string()
    .trim()
    .max(253)
    .regex(/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$|^[0-9A-Fa-f:]+$/, {
        error: "Must be a host name or an IP address, without scheme, port or path",
    });

/**
 * The `health` block of config.yaml. How often the domain controllers are measured is a
 * setting (`health_interval_seconds`, `health_replication_interval_seconds`).
 */
export const HealthConfigSchema = z
    .object({
        /**
         * Name servers of the domain that no zone lists: a hidden secondary. A host name
         * or an address each. The ones a zone lists are found without being named here.
         */
        dnsServers: z.array(DcAddressSchema).max(50).default([]),
    })
    .prefault({});

/**
 * A domain controller as the server holds it: what the directory lists, and what an
 * operator set for it here.
 */
export const DomainControllerSchema = z.object({
    /** The `objectGUID` of its NTDS settings. */
    id: z.string(),
    /** The server's name in the directory: `DC1`. */
    name: z.string(),
    dnsHostName: z.string().nullable(),
    site: z.string().nullable(),
    /** Set by an operator where `dnsHostName` does not resolve from this server; else null. */
    address: z.string().nullable(),
    firstSeen: z.string(),
    /** The agent that runs on it; null for a domain controller without one. */
    agent: DcAgentSchema.nullable(),
    /**
     * When the registration token issued for its agent expires; null when none is open. Only
     * the token's hash is kept. Past that moment the token is still named here, as expired.
     */
    agentRegistrationExpiresAt: z.string().nullable(),
});

/** `PUT /api/v1/domain-controllers/:id`. `null` or an empty string clears the address. */
export const UpdateDomainControllerSchema = z.object({
    address: z.union([DcAddressSchema, z.literal(""), z.null()]),
});

// REST request bodies
//
// What the HTTP endpoints accept. They exist for the same reason the WebSocket schemas do: an
// unchecked body reaches a repository or the config file unaltered.
// They live here rather than in the backend so the frontend can derive its types from them.

/** `POST /api/login`. An empty field is a malformed request, not a failed login. */
export const LoginPayloadSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
});

/**
 * A comma-separated list of `local` and `oidc`. The empty string is accepted because the
 * user dialog sends it when no box is ticked, and the controllers read it as "not given".
 */
const AuthMethodsSchema = z
    .string()
    .regex(
        /^((local|oidc)(,(local|oidc))*)?$/,
        'Must be a comma-separated list of "local" and "oidc"',
    );

/**
 * `POST /api/v1/users`. `password` is optional here because an OIDC-only user has none; that
 * a local user needs one is a rule about the combination, checked by the controller.
 */
export const CreateUserSchema = z.object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).optional(),
    auth_methods: AuthMethodsSchema.optional(),
});

/** `PUT /api/v1/users/:userId`. Either field alone is a valid edit. */
export const UpdateUserSchema = z.object({
    password: z.string().min(1).optional(),
    auth_methods: AuthMethodsSchema.optional(),
});

/**
 * A count, a number of days or an interval. YAML reads `30` without quotes as a number, and
 * the settings page sends back what it read, so both spellings are accepted and stored as
 * the string the rest of the backend expects.
 */
const WholeNumberSettingSchema = z
    .union([
        z.string().regex(/^\d+$/, "Must be a whole number"),
        z.number().int().nonnegative(),
    ])
    .transform(String);

/** A whole number within bounds, for a setting where a value outside them would do harm. */
const boundedWholeNumber = (min: number, max: number) =>
    WholeNumberSettingSchema.refine((value) => Number(value) >= min && Number(value) <= max, {
        error: `Must be from ${min} to ${max}`,
    });

/** How often the domain controllers are measured, and how often replication and the zones are read. */
const HealthIntervalSettingSchema = boundedWholeNumber(10, 3600);
const HealthReplicationIntervalSettingSchema = boundedWholeNumber(30, 86400);

/** How long a finding has to last before it is reported, or be gone before it is called off. */
const IssueWaitSettingSchema = boundedWholeNumber(0, MAX_ISSUE_WAIT_MINUTES);

/** How often an agent tries a fix or a replication again, how far apart, and how long the server waits for its outcome. */
const AgentRetriesSettingSchema = boundedWholeNumber(0, MAX_AGENT_RETRIES);
const AgentRetryDelaySettingSchema = boundedWholeNumber(1, MAX_AGENT_RETRY_DELAY_MINUTES);
const DbcheckFixTimeoutSettingSchema = boundedWholeNumber(10, 2880);
const ReplicationSyncTimeoutSettingSchema = boundedWholeNumber(5, 1440);

/** The wait of each kind of finding that has its own -- see `parseIssueTimingOverrides`. */
const IssueTimingOverridesSettingSchema = z.string().superRefine((text, ctx) => {
    const { error } = parseIssueTimingOverrides(text);
    if (error) ctx.addIssue({ code: "custom", message: error });
});

/**
 * Which level an event kind is recorded with, or `none` for not at all -- see
 * `parseLevelOverrides` for the format. Refused with the reason of the first entry that
 * cannot be read, so a typo is not an override that silently never applies.
 */
const ActivityLevelOverridesSettingSchema = z.string().superRefine((text, ctx) => {
    const { error } = parseLevelOverrides(text);
    if (error) ctx.addIssue({ code: "custom", message: error });
});

/**
 * `PUT /api/v1/settings/cleanup`.
 *
 * Loose on purpose: the settings page reads the whole block and sends it back, so a key an
 * operator added to config.yaml by hand travels through here on every save. A strict schema
 * would strip it and the save would delete it from the file.
 *
 * `security` is refused. It decides which proxies are believed and whether HSTS is sent,
 * the page never edits it, and it belongs to config.yaml alone.
 */
export const CleanupSettingsSchema = z.looseObject({
    notification_retention_days: WholeNumberSettingSchema.optional(),
    notification_retention_count: WholeNumberSettingSchema.optional(),
    notification_cleanup_interval_hours: WholeNumberSettingSchema.optional(),
    activity_level_overrides: ActivityLevelOverridesSettingSchema.optional(),
    health_max_clock_offset_seconds: WholeNumberSettingSchema.optional(),
    health_max_replication_age_minutes: WholeNumberSettingSchema.optional(),
    health_max_dbcheck_age_hours: WholeNumberSettingSchema.optional(),
    health_storage_warning_percent: WholeNumberSettingSchema.optional(),
    health_storage_error_percent: WholeNumberSettingSchema.optional(),
    health_certificate_warning_days: WholeNumberSettingSchema.optional(),
    health_certificate_error_days: WholeNumberSettingSchema.optional(),
    health_interval_seconds: HealthIntervalSettingSchema.optional(),
    health_replication_interval_seconds: HealthReplicationIntervalSettingSchema.optional(),
    issue_report_after_minutes: IssueWaitSettingSchema.optional(),
    issue_resolve_after_minutes: IssueWaitSettingSchema.optional(),
    issue_report_after_overrides: IssueTimingOverridesSettingSchema.optional(),
    dbcheck_fix_retries: AgentRetriesSettingSchema.optional(),
    dbcheck_fix_retry_delay_minutes: AgentRetryDelaySettingSchema.optional(),
    dbcheck_fix_timeout_minutes: DbcheckFixTimeoutSettingSchema.optional(),
    replication_sync_retries: AgentRetriesSettingSchema.optional(),
    replication_sync_retry_delay_minutes: AgentRetryDelaySettingSchema.optional(),
    replication_sync_timeout_minutes: ReplicationSyncTimeoutSettingSchema.optional(),
    security: z
        .undefined({
            error: "Configured in config.yaml only, not through this endpoint",
        })
        .optional(),
});

// Server configuration (config.yaml)

/**
 * The `settings` block, with every default the server falls back to. Loose for the same
 * reason CleanupSettingsSchema is: the settings page writes the block back whole, so a key
 * added by hand has to survive. Values are stored as strings, whatever spelling YAML used.
 */
export const AppSettingsSchema = z
    .looseObject({
        notification_retention_days: WholeNumberSettingSchema.default("90"),
        notification_retention_count: WholeNumberSettingSchema.default("500"),
        notification_cleanup_interval_hours: WholeNumberSettingSchema.default("24"),
        activity_level_overrides: ActivityLevelOverridesSettingSchema.default(""),
        /** From how many seconds on a domain controller's clock is too far off. Kerberos refuses at 300. */
        health_max_clock_offset_seconds: WholeNumberSettingSchema.default("300"),
        /** How many minutes old the last successful replication of a link may be. */
        health_max_replication_age_minutes: WholeNumberSettingSchema.default("60"),
        /** How many hours old the last database check may be, for a domain controller whose agent runs one. */
        health_max_dbcheck_age_hours: WholeNumberSettingSchema.default("36"),
        /** Below how many percent of free space a domain controller's storage is a warning, and an error. */
        health_storage_warning_percent: WholeNumberSettingSchema.default("15"),
        health_storage_error_percent: WholeNumberSettingSchema.default("5"),
        /** Fewer days than this before a certificate expires are a warning, and an error. */
        health_certificate_warning_days: WholeNumberSettingSchema.default("14"),
        health_certificate_error_days: WholeNumberSettingSchema.default("3"),
        /** Seconds between two measurements of every domain controller. */
        health_interval_seconds: HealthIntervalSettingSchema.default("60"),
        /** Seconds between two readings of replication, the object counts and the DNS zones. */
        health_replication_interval_seconds: HealthReplicationIntervalSettingSchema.default("300"),
        /** Minutes a finding has to last before the activity and the webhooks hear of it. */
        issue_report_after_minutes: IssueWaitSettingSchema.default(String(DEFAULT_ISSUE_REPORT_AFTER_MINUTES)),
        /** Minutes a reported finding has to be gone before it is called off. */
        issue_resolve_after_minutes: IssueWaitSettingSchema.default(String(DEFAULT_ISSUE_RESOLVE_AFTER_MINUTES)),
        /** The report wait of each kind of finding that has its own. */
        issue_report_after_overrides: IssueTimingOverridesSettingSchema.default(""),
        /** How often an agent tries fixing its database again while errors are left, and how many minutes apart. */
        dbcheck_fix_retries: AgentRetriesSettingSchema.default("2"),
        dbcheck_fix_retry_delay_minutes: AgentRetryDelaySettingSchema.default("10"),
        /** How many minutes the server waits for the outcome of a fix, every attempt included. */
        dbcheck_fix_timeout_minutes: DbcheckFixTimeoutSettingSchema.default("360"),
        /** The same for a replication from every inbound partner. */
        replication_sync_retries: AgentRetriesSettingSchema.default("2"),
        replication_sync_retry_delay_minutes: AgentRetryDelaySettingSchema.default("2"),
        replication_sync_timeout_minutes: ReplicationSyncTimeoutSettingSchema.default("30"),
    })
    .prefault({});

/**
 * OIDC. The example config ships the block with empty fields and `enabled: false`, so the
 * fields are only required -- and checked -- once the block is switched on.
 */
export const OidcConfigSchema = z
    .looseObject({
        enabled: z.boolean().default(false),
        issuer: z.string().nullish(),
        client_id: z.string().nullish(),
        client_secret: z.string().nullish(),
        redirect_uri: z.string().nullish(),
    })
    .superRefine((oidc, ctx) => {
        if (!oidc.enabled) return;
        for (const key of ["issuer", "redirect_uri"] as const) {
            if (!z.url().safeParse(oidc[key]).success) {
                ctx.addIssue({
                    code: "custom",
                    path: [key],
                    message: "Required as a URL while oidc.enabled is true",
                });
            }
        }
        for (const key of ["client_id", "client_secret"] as const) {
            if (!oidc[key]) {
                ctx.addIssue({
                    code: "custom",
                    path: [key],
                    message: "Required while oidc.enabled is true",
                });
            }
        }
    });

export const SecurityConfigSchema = z
    .object({
        /**
         * The reverse proxies whose X-Forwarded-For/-Proto/-Host this server believes.
         *
         * Empty by default, which means no one's: the client address is the socket's peer
         * and the scheme is the connection's own. Trusting every peer would let anyone who
         * reaches the port directly choose the address the login rate limit is taken from.
         * Behind a proxy, its address has to be listed here -- otherwise every request
         * appears to come from the proxy.
         */
        trusted_proxies: z.array(TrustedProxySchema).default([]),
        /** Send Strict-Transport-Security. Off unless set -- see config.example.yaml. */
        hsts: z.boolean().default(false),
        /**
         * Accept a certificate that does not validate from an agent this server dials as
         * `wss://`. Off by default; a decision about the installation, not about one agent.
         */
        allow_self_signed_agent_certificates: z.boolean().default(false),
    })
    .prefault({});

/**
 * The whole of config.yaml.
 *
 * Loose at the top level: saveConfig() writes the parsed object back into the YAML
 * document, so a strict schema would not only ignore a key an operator added -- the next
 * save would delete it from the file.
 *
 * `jwtSecret` is required although a fresh installation has none: the server generates and
 * saves it before this schema is applied, so a missing value at that point is an error, not
 * a server that signs tokens with `undefined`.
 */
export const AppConfigSchema = z.looseObject({
    jwtSecret: z.string().min(1),
    /** Any span @fastify/jwt accepts. There is no way to switch expiry off. */
    jwtExpiresIn: z.string().min(1).default("12h"),
    logLevel: LogLevelSchema.optional(),
    /**
     * Optional like `logLevel`, and for the same reason: left out it stays DEFAULT_SERVER_PORT,
     * and nothing writes the number into a file the operator never put it in.
     */
    port: z.number().int().min(1).max(65535).optional(),
    /**
     * What a reader without a session -- Home Assistant, a monitoring system -- sends as
     * `Authorization: Bearer` to read `GET /api/v1/status`, and nothing else. Optional: left
     * out, that route asks for a session like every other. SADM_STATUS_TOKEN wins over it.
     */
    statusToken: z.string().min(32, "statusToken needs at least 32 characters").optional(),
    oidc: blockOrMissing(OidcConfigSchema.optional()),
    settings: blockOrMissing(AppSettingsSchema),
    security: blockOrMissing(SecurityConfigSchema),
    directory: blockOrMissing(DirectoryConfigSchema),
    health: blockOrMissing(HealthConfigSchema),
});

export type AppConfigParsed = z.output<typeof AppConfigSchema>;

// ── Activity ─────────────────────────────────────────────────────────────────

/** What an event is about. */
export const ActivitySubjectSchema = z.object({
    /** The distinguished name of the directory object the event is about. */
    dn: z.string().optional(),
    /** What a reader calls it: an account name, a group, a domain controller. */
    name: z.string().optional(),
});

/**
 * One thing that happened. There is no sentence in here: the text is written out of `kind`
 * and `data` when the event is read, for the dashboard and the webhooks alike.
 *
 * `kind` is a plain string rather than an enum over `ACTIVITY_KINDS`, and `level` falls back
 * instead of refusing: the rows are read back out of a database another version may have
 * written to, and one row it cannot place must not take the list down.
 */
export const ActivityEventSchema = z.object({
    id: z.string().min(1),
    occurredAt: z.string().min(1),
    /** The domain controller the event is about, where it is about one. */
    dcId: z.string().nullish(),
    kind: z.string().min(1),
    level: z.enum(ACTIVITY_LEVELS).catch("info"),
    /** Groups events that belong together, entered by whoever caused them. */
    correlationId: z.string().nullish(),
    subject: ActivitySubjectSchema.nullish(),
    data: z.record(z.string(), z.unknown()).nullish(),
});

/** `POST /api/v1/activity/seen`. The events the calling user has seen. */
export const MarkActivitySeenSchema = z.object({
    ids: z.array(z.string().min(1)).min(1),
});

/** An event as a user is shown it. */
export const ActivityRecordSchema = ActivityEventSchema.extend({
    /**
     * Whether the user the list was read for has seen the event. Each user gets their own
     * answer; who else has seen it is not part of the record.
     */
    seen: z.boolean(),
});

// ── Webhooks ─────────────────────────────────────────────────────────────────

/** RFC 9110 token characters: what a header name may consist of. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * `POST /api/v1/webhooks`, `PUT /api/v1/webhooks/:id` and the body of a preview. The body
 * template stays a string: it is stored as the operator wrote it, indentation included, and
 * only checked here -- see webhookTemplate.ts for what it may contain.
 */
export const WebhookInputSchema = z.object({
    name: z.string().trim().min(1, "A name is required").max(100),
    enabled: z.boolean().default(true),
    url: z
        .string()
        .trim()
        .regex(/^https?:\/\/\S+$/i, "Must be an http:// or https:// URL")
        .refine((url) => placeholderError(url) === null, {
            error: (issue) => placeholderError(issue.input) ?? "Invalid placeholder",
        }),
    method: z.enum(WEBHOOK_METHODS).default("POST"),
    headers: z
        .record(z.string().regex(HEADER_NAME, "Not a valid header name"), z.string())
        .default({})
        .refine((headers) => placeholderError(Object.values(headers)) === null, {
            error: (issue) => placeholderError(Object.values(issue.input as object)) ?? "Invalid placeholder",
        }),
    bodyTemplate: z
        .string()
        .min(1, "A body template is required")
        .max(65536, "A body template may be at most 64 KiB")
        .refine((source) => webhookTemplateError(source) === null, {
            error: (issue) => webhookTemplateError(issue.input as string) ?? "Invalid template",
        }),
    minLevel: z.enum(ACTIVITY_LEVELS).default("warning"),
    /** Kind patterns such as `directory.*`; empty means every kind. */
    kinds: z.array(z.string().trim().min(1)).default([]),
    timeoutMs: z.number().int().min(1000).max(60000).default(10000),
});

/** A webhook as the API returns it: what was configured, and how its last delivery went. */
export const WebhookSchema = WebhookInputSchema.extend({
    id: z.string(),
    /** The HTTP status of the last attempt; null when it never got an answer. */
    lastStatus: z.number().nullable(),
    lastError: z.string().nullable(),
    lastAttemptAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string().nullable(),
});
