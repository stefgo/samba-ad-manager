import {
    type ActivityLevel,
    type DbcheckReport,
    type ReplicationSyncReport,
    type SeriesState,
} from "@sadm/shared";
import { replicationSyncActivity } from "./replicationSync.js";

/**
 * How the server records what an agent reports of an operation it tries again -- a fix of
 * the database, a replication from every partner: an attempt that is tried again as a trace
 * step, the last one as the outcome, with every attempt in its data. Pure: `DcAgentService`
 * writes the events.
 */

/** The two operations an agent tries again. */
export type SeriesKind = "dbcheck-fix" | "replication-sync";

/** How an operation is to be run, from the settings: what the request carries, and how long the server waits for its outcome. */
export interface SeriesSettings {
    retries: number;
    retryDelayMinutes: number;
    timeoutMs: number;
}

const DEFAULTS: Record<SeriesKind, { retries: number; delay: number; timeout: number }> = {
    "dbcheck-fix": { retries: 2, delay: 10, timeout: 360 },
    "replication-sync": { retries: 2, delay: 2, timeout: 30 },
};

const PREFIX: Record<SeriesKind, string> = { "dbcheck-fix": "dbcheck_fix", "replication-sync": "replication_sync" };

/** The settings of an operation, with the defaults for what is missing or no number. */
export function seriesSettings(settings: Readonly<Record<string, unknown>>, kind: SeriesKind): SeriesSettings {
    const defaults = DEFAULTS[kind];
    const whole = (key: string, fallback: number, min: number): number => {
        const value = Number(settings[`${PREFIX[kind]}_${key}`]);
        return Number.isInteger(value) && value >= min ? value : fallback;
    };
    return {
        retries: whole("retries", defaults.retries, 0),
        retryDelayMinutes: whole("retry_delay_minutes", defaults.delay, 1),
        timeoutMs: whole("timeout_minutes", defaults.timeout, 1) * 60_000,
    };
}

/** An event to record of one report: its kind, level and facts. */
export interface SeriesEvent<K extends string> {
    kind: K;
    level: ActivityLevel;
    data: Record<string, unknown>;
    /** Whether the operation is over with it: the outcome, not a step. */
    done: boolean;
}

/** What the outcome of an operation says of its attempts: how many, and each one. A report without a series was one attempt. */
const attemptsOf = (series: SeriesState | null | undefined, entry: Record<string, unknown>) => ({
    attempts: series?.attempt ?? 1,
    history: series?.history.length ? series.history : [entry],
});

/** Where an attempt that is tried again stands. */
const stepOf = (series: SeriesState) => ({
    attempt: series.attempt,
    of: series.of,
    ...(series.nextAttemptAt ? { nextAttemptAt: series.nextAttemptAt } : {}),
});

/**
 * The event a database check is recorded as when it followed a fix, or null for one that
 * did not. The level of the outcome: error when the fix failed and changed nothing, info
 * when no error is left, warning when some are, or the check after it could not be run.
 */
export function fixEvent(
    report: Pick<DbcheckReport, "errors" | "fix" | "series">,
): SeriesEvent<"agent.dbcheck_fix_attempted" | "agent.dbcheck_fixed"> | null {
    const fix = report.fix;
    if (!fix) return null;
    const entry = { errorsFound: fix.errorsFound, errorsRemaining: report.errors, ...(fix.error ? { error: fix.error } : {}) };
    const series = report.series;
    if (series && !series.done) {
        return { kind: "agent.dbcheck_fix_attempted", level: "trace", data: { ...entry, ...stepOf(series) }, done: false };
    }
    const level: ActivityLevel = fix.errorsFound === null ? "error" : report.errors === 0 ? "info" : "warning";
    return { kind: "agent.dbcheck_fixed", level, data: { ...entry, ...attemptsOf(series, entry) }, done: true };
}

/**
 * The event a replication is recorded as. The level of the outcome is `replicationSyncActivity`'s;
 * `hasPartners` says whether the directory lists other domain controllers to replicate from.
 */
export function syncEvent(
    report: ReplicationSyncReport,
    nameOf: (partnerId: string) => string | null,
    hasPartners: boolean,
): SeriesEvent<"agent.replication_sync_attempted" | "agent.replication_synced"> {
    const { level, data } = replicationSyncActivity(report, nameOf, hasPartners);
    const series = report.series;
    if (series && !series.done) {
        return { kind: "agent.replication_sync_attempted", level: "trace", data: { ...data, ...stepOf(series) }, done: false };
    }
    const entry = { links: data.links, failed: data.failed, ...(report.error ? { error: report.error } : {}) };
    return { kind: "agent.replication_synced", level, data: { ...data, ...attemptsOf(series, entry) }, done: true };
}

/**
 * The correlation id of an operation that is still under way by the last report, so that a
 * second request becomes part of it -- the agent treats it so. None for a report that is the
 * outcome, carries no series, or arrived longer ago than the server waits for an outcome.
 */
export function openSeriesId(
    last: { series?: SeriesState | null; receivedAt: string } | null | undefined,
    timeoutMs: number,
    now: number,
): string | null {
    const series = last?.series;
    if (!last || !series || series.done || !series.id) return null;
    return now - Date.parse(last.receivedAt) < timeoutMs ? series.id : null;
}
