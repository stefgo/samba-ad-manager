import db from "../core/Database.js";
import type {
    SchedulerId,
    SchedulerRunStatus,
    SchedulerRunSummary,
    SchedulerTrigger,
} from "@sadm/shared";

/**
 * A row of `scheduler_state` (migration 00). `last_result`
 * and `state` are JSON text.
 */
interface SchedulerStateRow {
    scheduler: string;
    next_run_at: string | null;
    running_since: string | null;
    running_trigger: string | null;
    last_started_at: string | null;
    last_finished_at: string | null;
    last_trigger: string | null;
    last_status: string | null;
    last_result: string | null;
    last_error: string | null;
    state: string | null;
}

/** JSON text as a value, or null for none and for text that does not parse. */
function parseJson(text: string | null): unknown {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * The one row each scheduler keeps: the run in progress, the last one it finished and the
 * state it carries from one run to the next. Every write is an upsert, so a scheduler that
 * never ran simply has no row.
 */
export class SchedulerStateRepository {
    private static row(scheduler: SchedulerId): SchedulerStateRow | undefined {
        return db
            .prepare("SELECT * FROM scheduler_state WHERE scheduler = ?")
            .get(scheduler) as SchedulerStateRow | undefined;
    }

    /** The last run the scheduler finished, or null if it never did. */
    static lastRun<Id extends SchedulerId>(scheduler: Id): SchedulerRunSummary<Id> | null {
        const row = this.row(scheduler);
        if (!row?.last_started_at || !row.last_status) return null;
        return {
            trigger: row.last_trigger as SchedulerTrigger,
            status: row.last_status as SchedulerRunStatus,
            startedAt: row.last_started_at,
            finishedAt: row.last_finished_at,
            result: parseJson(row.last_result) as SchedulerRunSummary<Id>["result"],
            error: row.last_error,
        };
    }

    /** What the scheduler saved with `saveState`, or null. */
    static state(scheduler: SchedulerId): unknown {
        return parseJson(this.row(scheduler)?.state ?? null);
    }

    /** When the timer planned the next run, or null while it has none planned. */
    static plannedRun(scheduler: SchedulerId): string | null {
        return this.row(scheduler)?.next_run_at ?? null;
    }

    /** Stores the run the timer planned, so a restart keeps it; null when it plans none. */
    static savePlannedRun(scheduler: SchedulerId, nextRunAt: string | null): void {
        db.prepare(`
            INSERT INTO scheduler_state (scheduler, next_run_at) VALUES (?, ?)
            ON CONFLICT(scheduler) DO UPDATE SET next_run_at = excluded.next_run_at
        `).run(scheduler, nextRunAt);
    }

    /** A run begins. The last finished run stays as it is until this one ends. */
    static markStarted(scheduler: SchedulerId, trigger: SchedulerTrigger, startedAt: string): void {
        db.prepare(`
            INSERT INTO scheduler_state (scheduler, running_since, running_trigger)
            VALUES (?, ?, ?)
            ON CONFLICT(scheduler) DO UPDATE SET
                running_since   = excluded.running_since,
                running_trigger = excluded.running_trigger
        `).run(scheduler, startedAt, trigger);
    }

    /** The run begun with `markStarted` ended; it becomes the last run. */
    static markFinished(
        scheduler: SchedulerId,
        status: Exclude<SchedulerRunStatus, "interrupted">,
        finishedAt: string,
        result: unknown,
        error: string | null,
    ): void {
        db.prepare(`
            UPDATE scheduler_state SET
                last_started_at  = running_since,
                last_trigger     = running_trigger,
                last_finished_at = ?,
                last_status      = ?,
                last_result      = ?,
                last_error       = ?,
                running_since    = NULL,
                running_trigger  = NULL
            WHERE scheduler = ?
        `).run(finishedAt, status, result === null ? null : JSON.stringify(result), error, scheduler);
    }

    /** Stores what the scheduler has to know on its next run, or after a restart. */
    static saveState(scheduler: SchedulerId, state: unknown): void {
        db.prepare(`
            INSERT INTO scheduler_state (scheduler, state) VALUES (?, ?)
            ON CONFLICT(scheduler) DO UPDATE SET state = excluded.state
        `).run(scheduler, JSON.stringify(state));
    }

    /**
     * At startup: a run still marked as in progress died with the previous process. It
     * becomes the last run, `interrupted`, with no finish time and no result. Returns how
     * many there were.
     */
    static markInterrupted(): number {
        return db.prepare(`
            UPDATE scheduler_state SET
                last_started_at  = running_since,
                last_trigger     = running_trigger,
                last_finished_at = NULL,
                last_status      = 'interrupted',
                last_result      = NULL,
                last_error       = 'The server stopped while the run was in progress',
                running_since    = NULL,
                running_trigger  = NULL
            WHERE running_since IS NOT NULL
        `).run().changes;
    }
}
