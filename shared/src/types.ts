import { z } from "zod";
import {
    ACTIVITY_KINDS,
    ACTIVITY_LEVELS,
    SCHEDULER_IDS,
    SCHEDULER_RUN_STATUSES,
    SCHEDULER_TRIGGERS,
} from "./constants.js";
import {
    LoginPayloadSchema,
    CreateUserSchema,
    UpdateUserSchema,
    CleanupSettingsSchema,
    DomainControllerSchema,
    UpdateDomainControllerSchema,
    ActivityEventSchema,
    ActivityRecordSchema,
    ActivitySubjectSchema,
    WebhookInputSchema,
    WebhookSchema,
} from "./schemas.js";
import {
    DomainIssueStateSchema,
    SchedulerStatusUpdateSchema,
    SchedulerStatusesSchema,
    UserSchema,
    WebhookTestResultSchema,
} from "./responses.js";

export type DomainController = z.infer<typeof DomainControllerSchema>;
export type DomainIssueState = z.infer<typeof DomainIssueStateSchema>;
export type UpdateDomainController = z.infer<typeof UpdateDomainControllerSchema>;

// REST request bodies
export type LoginPayload = z.infer<typeof LoginPayloadSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type CleanupSettings = z.infer<typeof CleanupSettingsSchema>;

// ── Activity ─────────────────────────────────────────────────────────────────

export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/**
 * The kinds this build writes. `ActivityEventSchema` accepts any string, so this is the
 * authoring type, not the parsing one: it is what a `kind` literal in our own code is
 * checked against.
 */
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type ActivitySubject = z.infer<typeof ActivitySubjectSchema>;

/**
 * One event as it is stored. There is no message in here: the text is written by
 * `activityMessage` (activityText.ts) out of `kind` and `data`, for the dashboard and the
 * webhooks alike -- which makes filtering by kind and level exact instead of a search over
 * sentences.
 */
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

/** An event as a user is shown it. */
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
