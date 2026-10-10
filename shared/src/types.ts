import { z } from "zod";
import {
    ACTIVITY_KINDS,
    ACTIVITY_LEVELS,
    ACTIVITY_SOURCES,
    CLIENT_STATUS,
    CONNECTION_MODE,
    SCHEDULER_IDS,
    SCHEDULER_RUN_STATUSES,
    SCHEDULER_TRIGGERS,
} from "./constants.js";
import {
    ClientSchema,
    RegistrationPayloadSchema,
    RegistrationResponseSchema,
    TokenSchema,
    CreatedTokenSchema,
    AuthPayloadSchema,
    LoginPayloadSchema,
    CreateUserSchema,
    UpdateUserSchema,
    CreateOutboundClientSchema,
    UpdateClientSchema,
    CleanupSettingsSchema,
    ActivityEventSchema,
    ActivityRecordSchema,
    ActivitySubjectSchema,
    WebhookInputSchema,
    WebhookSchema,
} from "./schemas.js";
import {
    SchedulerStatusUpdateSchema,
    SchedulerStatusesSchema,
    UserSchema,
    WebhookTestResultSchema,
} from "./responses.js";

import type { DcHealthReport } from "./dcHealth.js";
import type { AgentResponse } from "./agentActions.js";

export type RegistrationPayload = z.infer<typeof RegistrationPayloadSchema>;
export type RegistrationResponse = z.infer<typeof RegistrationResponseSchema>;

/**
 * Derived from the constants, so the value is written down in exactly one place and the
 * Zod enums in schemas.ts are built from the same objects.
 */
export type ClientStatus = (typeof CLIENT_STATUS)[keyof typeof CLIENT_STATUS];
export type ConnectionMode = (typeof CONNECTION_MODE)[keyof typeof CONNECTION_MODE];

export type Client = z.infer<typeof ClientSchema>;
export type Token = z.infer<typeof TokenSchema>;
export type CreatedToken = z.infer<typeof CreatedTokenSchema>;

// REST request bodies
export type LoginPayload = z.infer<typeof LoginPayloadSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type CreateOutboundClient = z.infer<typeof CreateOutboundClientSchema>;
export type UpdateClient = z.infer<typeof UpdateClientSchema>;
export type CleanupSettings = z.infer<typeof CleanupSettingsSchema>;

// WS Payloads
export type AuthPayload = z.infer<typeof AuthPayloadSchema>;

export interface WsMessage<T = unknown> {
    type: string;
    payload: T;
}

/**
 * Payload types per event. `req` is what the sending side puts on the wire for that event;
 * for the agent's own messages that is the agent, which sends them through the typed
 * helpers in Connection instead of stringifying objects by hand.
 */
export interface ProtocolMap {
    AUTH: {
        req: AuthPayload;
        res: void;
    };
    AUTH_SUCCESS: {
        req: void;
        res: { lastSyncTime?: string | null };
    };
    AUTH_FAILURE: {
        req: { error?: string };
        res: void;
    };
    ACTIVITY: {
        req: { events: ActivityEvent[] };
        res: void;
    };
    DC_HEALTH: {
        req: DcHealthReport;
        res: void;
    };
    AGENT_RESPONSE: {
        req: AgentResponse;
        res: void;
    };
}

// ── Activity ─────────────────────────────────────────────────────────────────

export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/**
 * The kinds this build can phrase. The wire accepts any string -- see `ActivityEventSchema`
 * -- so this is the authoring type, not the parsing one: it is what a `kind` literal in our
 * own code is checked against, while an incoming event may carry one nobody here knows yet.
 */
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type ActivitySubject = z.infer<typeof ActivitySubjectSchema>;

/**
 * One event as its originator sent it. There is no message in here: the text is written by
 * `activityMessage` (activityText.ts) out of `kind` and `data`, for the dashboard and the
 * webhooks alike. That is what lets an agent of an older version
 * stay useful -- it reports the same facts, and how they are worded is not its business --
 * and what makes filtering by kind and level exact instead of a search over sentences.
 */
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

/** An event as the server holds it. See `ActivityRecordSchema` for what the two times mean. */
export type ActivityRecord = z.infer<typeof ActivityRecordSchema>;

// ── Webhooks ─────────────────────────────────────────────────────────────────

export type WebhookInput = z.input<typeof WebhookInputSchema>;
export type Webhook = z.infer<typeof WebhookSchema>;

/** `POST /api/v1/webhooks/test`: what was sent, and what came back. */
export type WebhookTestResult = z.infer<typeof WebhookTestResultSchema>;

// ── Schedulers ───────────────────────────────────────────────────────────────

export type SchedulerId = (typeof SCHEDULER_IDS)[number];
export type SchedulerTrigger = (typeof SCHEDULER_TRIGGERS)[number];
export type SchedulerRunStatus = (typeof SCHEDULER_RUN_STATUSES)[number];

/** What each scheduler reports as the result of a run. */
export interface SchedulerRunResults {
    "notification-cleanup": { removed: number };
    "token-cleanup": { removed: number };
}

/** The last run a scheduler finished, as `scheduler_state` holds it. */
export interface SchedulerRunSummary<Id extends SchedulerId = SchedulerId> {
    trigger: SchedulerTrigger;
    status: SchedulerRunStatus;
    startedAt: string;
    /** Null for a run the server did not live to finish (`interrupted`). */
    finishedAt: string | null;
    /** Null unless the run succeeded, fully or in part. */
    result: SchedulerRunResults[Id] | null;
    error: string | null;
}

export interface SchedulerStatus<Id extends SchedulerId = SchedulerId> {
    isRunning: boolean;
    /** Null when the scheduler is switched off. */
    nextRun: string | null;
    lastRun: SchedulerRunSummary<Id> | null;
}

/** `GET /api/v1/settings/scheduler-status`: every scheduler the server runs. */
export type SchedulerStatuses = {
    [Id in SchedulerId]: SchedulerStatus<Id>;
};

/** The payload of `SCHEDULER_STATUS_UPDATE`: one scheduler, whenever a run starts or ends. */
export type SchedulerStatusUpdate = {
    [Id in SchedulerId]: { scheduler: Id; status: SchedulerStatuses[Id] };
}[SchedulerId];

/**
 * The dashboard parses `SCHEDULER_STATUS_UPDATE` with `SchedulerStatusUpdateSchema`, which
 * is written separately from the types above. This fails to compile as soon as the two
 * drift apart, in either direction.
 */
const schedulerStatusUpdateMatchesSchema: [
    (update: SchedulerStatusUpdate) => z.infer<typeof SchedulerStatusUpdateSchema>,
    (parsed: z.infer<typeof SchedulerStatusUpdateSchema>) => SchedulerStatusUpdate,
] = [(update) => update, (parsed) => parsed];
void schedulerStatusUpdateMatchesSchema;

const schedulerStatusesMatchSchema: [
    (statuses: SchedulerStatuses) => z.infer<typeof SchedulerStatusesSchema>,
    (parsed: z.infer<typeof SchedulerStatusesSchema>) => SchedulerStatuses,
] = [(statuses) => statuses, (parsed) => parsed];
void schedulerStatusesMatchSchema;

// ── Users ────────────────────────────────────────────────────────────────────

/** One row of `GET /api/v1/users`. */
export type User = z.infer<typeof UserSchema>;
