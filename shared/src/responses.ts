import { z } from "zod";
import {
    ACTIVITY_LEVELS,
    SCHEDULER_RUN_STATUSES,
    SCHEDULER_TRIGGERS,
    WEBHOOK_METHODS,
} from "./constants.js";
import { ActivityRecordSchema, DomainControllerSchema } from "./schemas.js";
import { DcHealthSchema, DnsServerHealthSchema } from "./dcHealth.js";

/**
 * What the server sends a browser, one schema per shape: the answers of the REST endpoints
 * and the payloads of the dashboard socket (`dashboardMessages.ts`).
 *
 * The frontend parses every response against one of these (`lib/api.ts`), so a field
 * renamed on the server fails loudly at the request instead of arriving in a component as
 * `undefined`.
 *
 * They describe what is sent, not what is accepted: none of the input rules of `schemas.ts`
 * apply here. A row somebody edited by hand must not take a whole list down because its
 * name is longer than the form would allow. Nullability follows what the server sends,
 * which for a row read out of SQLite is `null` and not a missing key.
 */

// ── Domain controllers ───────────────────────────────────────────────────────

/** `GET /api/v1/domain-controllers` and `DOMAIN_CONTROLLERS_UPDATE`. */
export const DomainControllerListSchema = z.array(DomainControllerSchema);

// ── Domain controller health ─────────────────────────────────────────────────

/** `GET /api/v1/dc-health`: the last measurement of every domain controller that has one. */
export const DcHealthListSchema = z.array(DcHealthSchema);

/** `GET /api/v1/dc-health/name-servers` and `DNS_SERVERS_UPDATE`: every name server that is no domain controller. */
export const DnsServerHealthListSchema = z.array(DnsServerHealthSchema);

/**
 * One finding as the server tracks it for the activity. The finding itself -- what is wrong
 * -- the dashboard derives on its own; this is only when the activity hears of it.
 */
export const DomainIssueStateSchema = z.object({
    /** `DomainIssue.id`. */
    id: z.string(),
    /** `pending`: not reported yet, because it has not lasted long enough. `open`: reported. */
    state: z.enum(["pending", "open"]),
    /** Since when the finding has been there, over gaps too short to call it gone. */
    since: z.string(),
    /** When a pending finding is reported if it lasts; null once it has been. */
    reportAt: z.string().nullable(),
    /** When it was reported; null while it is pending. */
    openedAt: z.string().nullable(),
});

/** `GET /api/v1/dc-health/issues` and `DOMAIN_ISSUES_UPDATE`: every finding the server tracks. */
export const DomainIssueStateListSchema = z.array(DomainIssueStateSchema);

// ── Activity ─────────────────────────────────────────────────────────────────

/** `GET /api/v1/activity`, `ACTIVITY_UPDATE` and `ACTIVITY_APPENDED`. */
export const ActivityListSchema = z.array(ActivityRecordSchema);

// ── Schedulers ───────────────────────────────────────────────────────────────

/**
 * One scheduler's status. Every scheduler reports `{ removed }` as the result of a run.
 *
 * The result is read out of `scheduler_state`, where a run of an earlier version may have
 * left another shape behind. That reads as "no result" instead of refusing the status of
 * every scheduler along with it.
 */
const SchedulerStatusSchema = z.object({
    isRunning: z.boolean(),
    /** Null when the scheduler is switched off. */
    nextRun: z.string().nullable(),
    lastRun: z
        .object({
            trigger: z.enum(SCHEDULER_TRIGGERS),
            status: z.enum(SCHEDULER_RUN_STATUSES),
            startedAt: z.string(),
            /** Null for a run the server did not live to finish (`interrupted`). */
            finishedAt: z.string().nullable(),
            /** Null unless the run succeeded, fully or in part. */
            result: z.object({ removed: z.number() }).nullable().catch(null),
            error: z.string().nullable(),
        })
        .nullable(),
});

/** Every scheduler the server runs, by its id. `SCHEDULER_IDS` lists the same ones. */
export const SchedulerStatusesSchema = z.object({
    "notification-cleanup": SchedulerStatusSchema,
});

/** `GET /api/v1/settings/scheduler-status`. */
export const SchedulerStatusResponseSchema = z.object({ schedulers: SchedulerStatusesSchema });

const schedulerUpdate = <Id extends keyof typeof SchedulerStatusesSchema.shape>(id: Id) =>
    z.object({ scheduler: z.literal(id), status: SchedulerStatusesSchema.shape[id] });

/**
 * The payload of `SCHEDULER_STATUS_UPDATE`: one scheduler, whenever a run starts or ends.
 * The types in types.ts are written by hand, generic over the scheduler; this schema is
 * checked against them there.
 */
export const SchedulerStatusUpdateSchema = z.discriminatedUnion("scheduler", [schedulerUpdate("notification-cleanup")]);

// ── Users, session ───────────────────────────────────────────────────────────

/** One row of `GET /api/v1/users`; the password hash is not among the columns. */
export const UserSchema = z.object({
    id: z.number(),
    username: z.string(),
    auth_methods: z.string().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
});

export const UserListSchema = z.array(UserSchema);

/** `GET /api/v1/me`: who the session belongs to, and until when. */
export const SessionUserSchema = z.object({
    id: z.number().nullish(),
    username: z.string().nullish(),
    expiresAt: z.string().nullish(),
});

/** `GET /api/auth/config`: which login the form offers. */
export const AuthConfigSchema = z.object({
    type: z.enum(["local", "oidc"]),
});

// ── Settings ─────────────────────────────────────────────────────────────────

/**
 * `GET /api/v1/settings/cleanup`: the settings block of config.yaml, as it stands. Loose,
 * like the file -- a value an operator wrote by hand is a number there and a string once
 * the UI has saved it.
 */
export const SettingsResponseSchema = z.record(z.string(), z.unknown());

/** What a maintenance job started by hand reports: `POST /api/v1/settings/cleanup/*`. */
export const ManualRunResultSchema = z.object({
    removed: z.number().optional(),
});

// ── Webhooks ─────────────────────────────────────────────────────────────────

/**
 * A webhook as the API returns it: what was configured, and how its last delivery went.
 * The shape of `WebhookSchema` without its input rules, see above.
 */
export const WebhookViewSchema = z.object({
    id: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    url: z.string(),
    method: z.enum(WEBHOOK_METHODS),
    headers: z.record(z.string(), z.string()),
    bodyTemplate: z.string(),
    minLevel: z.enum(ACTIVITY_LEVELS),
    /** Kind patterns such as `directory.*`; empty means every kind. */
    kinds: z.array(z.string()),
    timeoutMs: z.number(),
    /** The HTTP status of the last attempt; null when it never got an answer. */
    lastStatus: z.number().nullable(),
    lastError: z.string().nullable(),
    lastAttemptAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string().nullable(),
});

/** `GET /api/v1/webhooks`. */
export const WebhookListSchema = z.array(WebhookViewSchema);

/** `POST /api/v1/webhooks/test`: what was sent, and what came back. */
export const WebhookTestResultSchema = z.object({
    ok: z.boolean(),
    status: z.number().nullable(),
    error: z.string().nullable(),
    /** The rendered body, as it went out. */
    body: z.unknown(),
    /** The start of the target's answer, for seeing why it refused. */
    response: z.string().nullable(),
});
