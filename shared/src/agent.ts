import { z } from "zod";
import { LogLevelSchema } from "./validation.js";
import { normaliseTargetAddress } from "./targetAddress.js";

/**
 * The agent: a process inside a domain controller's container that reports what cannot be
 * read over the network -- which of Samba's services run, how full the volume is, what the
 * sysvol holds, and the database check. Optional per domain controller; one without an agent
 * is measured over the network like any other.
 *
 * Agent and server are updated separately: the image a domain controller runs is rebuilt on
 * its own schedule. Three rules follow, in both directions. A receiver drops what it does not
 * know -- an unknown message type, an unknown field. A new field is optional. And a
 * vocabulary is read tolerantly: plain strings where an enum would refuse the whole message.
 * That is why the schemas here are loose, unlike those of a measurement, where what writes
 * one and what reads one are the same build.
 */

/** What agent and server send each other over `/ws/agent`. */
export const AGENT_EVENTS = {
    /** Agent → server: who it is and what it can do. The first message on every connection. */
    AUTH: "AUTH",
    /** Server → agent: the connection is accepted. */
    AUTH_SUCCESS: "AUTH_SUCCESS",
    /** Server → agent: it is not, and why. The server closes the socket right after. */
    AUTH_FAILURE: "AUTH_FAILURE",
    /** Agent → server: what it reads locally -- services, processes, storage, sysvol. */
    LOCAL_REPORT: "LOCAL_REPORT",
    /** Agent → server: the result of a database check. */
    DBCHECK_REPORT: "DBCHECK_REPORT",
    /** Server → agent: read everything now and send it, changed or not. */
    REQUEST_REPORT: "REQUEST_REPORT",
    /** Server → agent: run the database check now. */
    REQUEST_DBCHECK: "REQUEST_DBCHECK",
    /**
     * Server → agent: fix what the database check finds, then check again. Without a
     * payload: everything the check finds is fixed, nothing is chosen. An agent whose
     * operator did not allow it drops the request.
     */
    REQUEST_DBCHECK_FIX: "REQUEST_DBCHECK_FIX",

    // On the agent's own `/ws/register`, when the server dials it for the first time
    /** Server → agent: the setup PIN, and the identity the agent is to keep. */
    REGISTRATION_REQUEST: "REGISTRATION_REQUEST",
    /** Agent → server: the identity is stored. */
    REGISTRATION_SUCCESS: "REGISTRATION_SUCCESS",
    /** Agent → server: it is not, and why. */
    REGISTRATION_FAILURE: "REGISTRATION_FAILURE",
} as const;

/**
 * What an agent says it can do, in the `capabilities` list of its AUTH payload. An agent
 * that predates a capability does not name it, and the server then knows not to expect that
 * of it -- instead of comparing version strings.
 *
 * Each of them is something the server asks for or waits for. A message the other side merely
 * drops needs no entry here.
 */
export const AGENT_CAPABILITIES = {
    /** Reports what it reads locally (`LOCAL_REPORT`). */
    LOCAL: "local",
    /** Runs the database check, on its own schedule and when asked. */
    DBCHECK: "dbcheck",
    /**
     * Fixes what the database check finds, when asked (`REQUEST_DBCHECK_FIX`). Named only
     * by an agent whose operator allowed it (`report.dbcheckAllowFix`): it writes to the
     * directory's database.
     */
    DBCHECK_FIX: "dbcheck-fix",
} as const;

/**
 * Who dials. Named from the server's side, and that is the only reading used anywhere:
 * `inbound` is an agent that dials the server, `outbound` one the server dials.
 */
export const CONNECTION_MODES = ["inbound", "outbound"] as const;
export type ConnectionMode = (typeof CONNECTION_MODES)[number];

/**
 * The port an agent's local web server listens on unless its config.yaml names another.
 * The server appends it when an outbound target address is given without one, and the
 * agent falls back to it -- one number for both sides of the same default.
 */
export const DEFAULT_AGENT_PORT = 3021;

/** One message on the wire, in either direction. */
export interface AgentMessage<T = unknown> {
    type: string;
    payload: T;
}

// ── What the agent reports ───────────────────────────────────────────────────

/** Why a part of the report is missing. */
const LocalErrorSchema = z.looseObject({
    /** Which part: `services`, `processes`, `storage`, `sysvol`. */
    source: z.string(),
    message: z.string(),
});

/**
 * What an agent reads on its domain controller. Every part may be missing on its own, and
 * one that could not be read says why in `errors` -- as in a measurement.
 */
export const DcLocalReportSchema = z.looseObject({
    collectedAt: z.string().min(1),
    /**
     * The services of the `samba` process that are registered with its internal messaging:
     * what `samba-tool processes` lists, under the names it lists them by (`kdc_server`,
     * `dreplsrv`). `configured` is `server services` from smb.conf -- what should be there.
     */
    services: z
        .looseObject({
            configured: z.array(z.string()),
            running: z.array(z.looseObject({ name: z.string(), pids: z.array(z.number().int()) })),
        })
        .nullish(),
    /** The programs the container's supervisord runs: Samba itself, BIND. */
    processes: z
        .array(
            z.looseObject({
                name: z.string(),
                /** supervisord's own word: `RUNNING`, `BACKOFF`, `FATAL`, `EXITED`. */
                state: z.string(),
                pid: z.number().int().nullish(),
                /** ISO time of the last start; null for one that never started. */
                startedAt: z.string().nullish(),
                exitStatus: z.number().int().nullish(),
                /** How often the agent has seen it start within the last hour. */
                recentStarts: z.number().int().nullish(),
            }),
        )
        .nullish(),
    /** The file system Samba's databases live on. */
    storage: z
        .looseObject({
            path: z.string(),
            totalBytes: z.number(),
            freeBytes: z.number(),
            /** The size of the directory database, all partitions together. */
            databaseBytes: z.number().nullish(),
        })
        .nullish(),
    /** The group policies as this domain controller's sysvol holds them. */
    sysvol: z
        .looseObject({
            path: z.string(),
            gpos: z.array(
                z.looseObject({
                    /** The policy's GUID, as its folder is named, without the braces and in lower case. */
                    guid: z.string(),
                    /** `Version` from its GPT.INI; null for a folder without a readable one. */
                    version: z.number().int().nullable(),
                }),
            ),
        })
        .nullish(),
    errors: z.array(LocalErrorSchema).default([]),
});

/** The last report of a domain controller's agent, and when it arrived. */
export const DcLocalSchema = DcLocalReportSchema.extend({
    receivedAt: z.string(),
});

/**
 * `DBCHECK_REPORT`: the result of one run of Samba's database check, over every partition
 * the domain controller holds. Which domain controller it is of says the connection.
 */
export const DbcheckReportSchema = z.looseObject({
    /** When the check finished, by the domain controller's clock. */
    checkedAt: z.iso.datetime({ offset: true }),
    /** How many errors the check counted; null when the check itself failed. */
    errors: z.number().int().min(0).nullable(),
    durationMs: z.number().min(0).nullish(),
    /** Why there is no count. */
    error: z.string().max(2000).nullish(),
    /**
     * The fix this check followed, for a check that was run right after one: the count
     * above is then what is left. Absent for a check that was run on its own.
     */
    fix: z
        .looseObject({
            /** When the fix was committed or given up, by the domain controller's clock. */
            fixedAt: z.iso.datetime({ offset: true }),
            /** How many errors the fixing run found and went at; null when it failed. */
            errorsFound: z.number().int().min(0).nullable(),
            durationMs: z.number().min(0).nullish(),
            /** Why the fix failed. Nothing of it was written: it runs in one transaction. */
            error: z.string().max(2000).nullish(),
        })
        .nullish(),
});

// ── The handshake ────────────────────────────────────────────────────────────

/** `AUTH`. */
export const AgentAuthPayloadSchema = z.looseObject({
    hostname: z.string(),
    version: z.string().optional(),
    /**
     * The GUID of the NTDS settings of the domain controller the agent runs on, as it reads
     * it from the local database. The server refuses an agent whose identity belongs to
     * another domain controller: a volume moved from one to the other.
     */
    dcId: z.string().min(1),
    /** From `AGENT_CAPABILITIES`. Plain strings: a newer agent may name what this server has never heard of. */
    capabilities: z.array(z.string()).default([]),
});

/** The identity the server issues at registration, as the agent stores it. */
export const AgentIdentitySchema = z.object({
    /** The id of the domain controller the agent belongs to. */
    clientId: z.string().min(1),
    authToken: z.string().min(1),
});

/** `POST /api/v1/register`: what an agent that dials in registers with. */
export const AgentRegistrationSchema = z.looseObject({
    /** The registration token issued on the domain controller's page. */
    token: z.string().min(1),
    /** The domain controller the agent runs on. The token is good for that one only. */
    dcId: z.string().min(1),
    hostname: z.string().optional(),
});

/** What `POST /api/v1/register` answers with. */
export const AgentRegistrationResponseSchema = z.looseObject({
    token: z.string().min(1),
    clientId: z.string().min(1),
});

/** `REGISTRATION_REQUEST` on the agent's `/ws/register`. */
export const AgentRegistrationRequestSchema = z.looseObject({
    /** The agent's setup PIN or its `SADM_REGISTRATION_SECRET`. */
    secret: z.string(),
    authToken: z.string().min(1),
    /** The domain controller the server takes the agent to belong to. The agent refuses another one's. */
    clientId: z.string().min(1),
});

// ── The agent on the server ──────────────────────────────────────────────────

/** A domain controller's agent, as the server knows it. */
export const DcAgentSchema = z.object({
    connectionMode: z.enum(CONNECTION_MODES),
    /** Outbound only: where the server dials it. */
    targetAddress: z.string().nullable(),
    registeredAt: z.string(),
    connected: z.boolean(),
    /** When it last connected or was last heard of; null for one that never connected. */
    lastSeen: z.string().nullable(),
    hostname: z.string().nullable(),
    version: z.string().nullable(),
    /** What it said it can do when it last connected. */
    capabilities: z.array(z.string()),
});

/**
 * An outbound agent's address as an operator types it: `host`, `host:port` or
 * `wss://host:port`. Stored in its normalised form.
 */
export const TargetAddressSchema = z
    .string()
    .transform((value) => normaliseTargetAddress(value))
    .refine((address): address is string => address !== null, {
        error: "Must be a host or host:port, without path or credentials",
    });

/**
 * `POST /api/v1/domain-controllers/:id/agent/token`: the one response that carries the
 * registration token in the clear. The server stores only its hash.
 */
export const CreatedAgentTokenSchema = z.object({
    token: z.string(),
    expiresAt: z.string(),
});

/** `POST /api/v1/domain-controllers/:id/agent/connect`: have the server dial an agent and register it. */
export const ConnectAgentSchema = z.object({
    targetAddress: TargetAddressSchema,
    /** The setup PIN from the agent's log, or its `SADM_REGISTRATION_SECRET`. */
    registrationSecret: z.string().trim().min(1, "The setup PIN is required"),
});

/**
 * `PUT /api/v1/domain-controllers/:id/agent`: where the server dials an agent it reaches
 * itself. The one thing about an agent that is the operator's to say -- everything else it
 * says of itself when it connects.
 */
export const UpdateAgentSchema = z.object({
    targetAddress: TargetAddressSchema,
});

// ── The agent's own configuration ────────────────────────────────────────────

/** YAML turns an empty block into null. */
const blockOrMissing = <T extends z.ZodType>(schema: T) => z.preprocess((value) => value ?? undefined, schema);

/** A single IPv4 address or an IPv4 network in CIDR notation. */
export const Ipv4OrCidrSchema = z.union([z.ipv4(), z.cidrv4()], {
    error: "Must be an IPv4 address or an IPv4 network in CIDR notation",
});

/** Where the certificate and its private key are, for an agent that terminates TLS. */
export const AgentTlsConfigSchema = z.object({
    cert: z.string().trim().min(1, { error: "Must be the path to a certificate file" }),
    key: z.string().trim().min(1, { error: "Must be the path to a private key file" }),
});

/** The agent's `samba` block: how the local Samba is read. */
export const AgentSambaConfigSchema = z
    .object({
        /** The interpreter Samba's own Python modules are installed for. */
        python: z.string().trim().min(1).default("python3"),
        /** The socket of the supervisord that runs Samba; empty where there is none. */
        supervisorSocket: z.string().trim().default("/var/run/supervisor.sock"),
    })
    .prefault({});

/** The agent's `report` block: how often it reads. */
export const AgentReportConfigSchema = z
    .object({
        /** Seconds between two readings. */
        interval: z.number().int().min(10).max(3600).default(30),
        /** Hours between two database checks; 0 runs one only when the server asks. */
        dbcheckIntervalHours: z.number().int().min(0).max(720).default(24),
        /**
         * Whether the server may have this agent fix what the database check finds. Off by
         * default: it is the one thing the agent writes, and whether it may is the decision
         * of whoever runs the domain controller, not of a login of the dashboard.
         */
        dbcheckAllowFix: z.boolean().default(false),
    })
    .prefault({});

/**
 * The whole of the agent's config.yaml -- everything the operator writes, and nothing the
 * agent writes back: the identity is issued by the server and lives in the agent's data
 * directory.
 *
 * Loose at the top level, so a key this version does not know stays a key it ignores rather
 * than a reason not to start. Every field carries its default, which makes this schema the
 * one place that says what an agent without a config.yaml does.
 */
export const AgentConfigSchema = z.looseObject({
    /** Where the server is, for an agent that dials in. */
    serverUrl: z.string().trim().min(1).nullish(),
    logLevel: LogLevelSchema.default("info"),
    samba: blockOrMissing(AgentSambaConfigSchema),
    report: blockOrMissing(AgentReportConfigSchema),
    /**
     * The two pages of the local web server. Off unless asked for: the agent runs in the
     * network of its domain controller, where an open page is open to everyone who reaches it.
     */
    enableStatusPage: z.boolean().default(false),
    enableRegisterPage: z.boolean().default(false),
    /** Networks the server may dial `/ws/register` and `/ws/agent` from. Empty: no restriction. */
    allowedNetworks: z.array(Ipv4OrCidrSchema).default([]),
    /** The port the local web server listens on. Coerced, because `SADM_CLIENT_PORT` is laid over it as a string. */
    listenPort: z.coerce
        .number({ error: "Must be an integer between 1 and 65535" })
        .int({ error: "Must be an integer between 1 and 65535" })
        .min(1)
        .max(65535)
        .default(DEFAULT_AGENT_PORT),
    /** Accept a server certificate that does not validate, for registration and for the WebSocket alike. */
    allowSelfSignedCertificates: z.boolean().default(false),
    /** Serve the agent's own web server over TLS, for a server that dials it as `wss://`. */
    tls: blockOrMissing(AgentTlsConfigSchema.optional()),
});

export type AgentConfigParsed = z.output<typeof AgentConfigSchema>;

/** `POST /api/register` on the agent's own web server. */
export const AgentWebRegisterSchema = z.object({
    url: z.url({ protocol: /^https?$/, error: "Must be an http:// or https:// URL" }),
    token: z.string().trim().min(1),
    pin: z.string().trim().min(1),
});

export type DcLocalReport = z.infer<typeof DcLocalReportSchema>;
export type DcLocal = z.infer<typeof DcLocalSchema>;
export type DbcheckReport = z.infer<typeof DbcheckReportSchema>;
export type AgentAuthPayload = z.infer<typeof AgentAuthPayloadSchema>;
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;
export type AgentRegistration = z.infer<typeof AgentRegistrationSchema>;
export type AgentRegistrationRequest = z.infer<typeof AgentRegistrationRequestSchema>;
export type DcAgent = z.infer<typeof DcAgentSchema>;
export type CreatedAgentToken = z.infer<typeof CreatedAgentTokenSchema>;
export type ConnectAgent = z.infer<typeof ConnectAgentSchema>;
