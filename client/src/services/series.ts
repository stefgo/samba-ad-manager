import { z } from "zod";
import type { AgentSeriesRequest, SeriesState } from "@sadm/shared";

/**
 * An operation the server asked for that the agent tries again while it has not succeeded:
 * a fix of the database, a replication from every partner. The agent runs it, so the agent
 * keeps where it stands -- in its data directory, so that a restart picks it up where it was.
 *
 * Pure: the services keep the state, run the attempts and report them.
 */
export const SeriesSchema = z.object({
    /** The correlation id the request carried, sent back with every report; null for none. */
    id: z.string().nullable(),
    /** The attempt that runs, or that runs next. */
    attempt: z.number().int().min(1),
    of: z.number().int().min(1),
    delayMs: z.number().int().min(0),
    /** When the next attempt runs; null while one runs. */
    nextAttemptAt: z.string().nullable(),
    /** One entry per attempt done, the latest last. */
    history: z.array(z.record(z.string(), z.unknown())),
});

export type Series = z.infer<typeof SeriesSchema>;

/** The operation a request starts: one attempt, and as many more as it asks for. */
export function startSeries(request: AgentSeriesRequest): Series {
    return {
        id: request.correlationId ?? null,
        attempt: 1,
        of: 1 + (request.retries ?? 0),
        delayMs: (request.retryDelayMinutes ?? 1) * 60_000,
        nextAttemptAt: null,
        history: [],
    };
}

export interface SeriesStep {
    /** What the report of this attempt says of the operation. */
    state: SeriesState;
    /** The operation as it stands now, or null when it is over. */
    series: Series | null;
}

/**
 * Where the operation stands after an attempt. `succeeded` says whether the attempt left
 * nothing to try again; `entry` is what the history keeps of it. Another attempt follows
 * when this one did not succeed and attempts are left.
 */
export function afterAttempt(series: Series, succeeded: boolean, entry: Record<string, unknown>, now: number): SeriesStep {
    const history = [...series.history, entry];
    const done = succeeded || series.attempt >= series.of;
    const nextAttemptAt = done ? null : new Date(now + series.delayMs).toISOString();
    return {
        state: { id: series.id, attempt: series.attempt, of: series.of, nextAttemptAt, done, history },
        series: done ? null : { ...series, attempt: series.attempt + 1, nextAttemptAt, history },
    };
}

/** How long until the next attempt of an operation that was waiting when the agent stopped; 0 when it is due. */
export const waitBeforeResuming = (series: Series, now: number): number =>
    series.nextAttemptAt ? Math.max(0, Date.parse(series.nextAttemptAt) - now) : 0;
