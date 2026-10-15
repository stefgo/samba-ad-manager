import type { SeriesState } from "@sadm/shared";
import { formatDate, formatTime } from "../../../utils";

/**
 * Where an operation the agent tries again stands, in a few words: which attempt it is at and
 * when the next runs. Null once it is over, or for a report that carries no operation.
 */
export function seriesText(series: SeriesState | null | undefined, now: number, locale?: string): string | null {
    if (!series || series.done) return null;
    const next = series.nextAttemptAt;
    if (!next) return `Attempt ${series.attempt} of ${series.of}`;
    const at = new Date(next).toDateString() === new Date(now).toDateString() ? formatTime(next, locale) : formatDate(next, { locale });
    return `Attempt ${series.attempt} of ${series.of} left something to do; attempt ${series.attempt + 1} at ${at}`;
}

/** " (3 attempts)" behind the outcome of an operation that took more than one. */
export const attemptsSuffix = (series: SeriesState | null | undefined): string =>
    series && series.done && series.attempt > 1 ? ` (${series.attempt} attempts)` : "";
