import type { AlertOptions } from "@stefgo/react-ui-components";

/** What every view shows for a value that is not there. */
export const EMPTY_VALUE = "–";

/** A date from the API as a `Date`, or null when there is none or it cannot be read. */
const toDate = (date: Date | string | number | null | undefined): Date | null => {
    if (!date) return null;

    let d = new Date(date);

    if (typeof date === "string") {
        // Handle SQLite default format "YYYY-MM-DD HH:MM:SS" -> Treat as UTC
        if (date.includes(" ") && !date.includes("T")) {
            d = new Date(date.replace(" ", "T") + "Z");
        }
    }

    return isNaN(d.getTime()) ? null : d;
};

/** The same in milliseconds, for what is compared rather than shown. */
export const toTimestamp = (date: Date | string | number | null | undefined): number | null =>
    toDate(date)?.getTime() ?? null;

/**
 * The one date format of the interface, as the viewer's own locale writes it: the order
 * of day and month and the clock are theirs, not the application's. `locale` is for a
 * caller that must not depend on where it runs; left out, the browser's is taken.
 *
 * Seconds only where they tell events apart -- the activity list, where several steps of
 * one operation land within the same minute.
 */
export const formatDate = (
    date: Date | string | number | null | undefined,
    { seconds = false, locale }: { seconds?: boolean; locale?: string } = {},
): string => {
    const d = toDate(date);
    if (!d) return EMPTY_VALUE;

    return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        ...(seconds ? { second: "2-digit" as const } : {}),
    }).format(d);
};

/**
 * How long ago something happened, short enough for a column: "just now", "5 min ago",
 * "2 h ago", "3 d ago". Past thirty days the distance stops saying anything, and a date
 * that lies ahead has none, so both are written out as the date they are.
 *
 * A column of these reads as "what was recent"; the date itself belongs in the tooltip
 * next to it (`RelativeTime`).
 */
export const formatRelative = (
    date: Date | string | number | null | undefined,
    now: number,
    locale?: string,
): string => {
    const at = toTimestamp(date);
    if (at === null) return EMPTY_VALUE;

    const minutes = Math.floor((now - at) / 60_000);
    // A clock that is a little ahead of the host's must not turn "now" into a date.
    if (minutes < 1 && now - at > -60_000) return "just now";
    if (minutes < 0) return formatDate(at, { locale });
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    if (days <= 30) return `${days} d ago`;
    return formatDate(at, { locale });
};

/** The time of day alone, for entries that sit under a dated one. */
export const formatTime = (date: Date | string | number | null | undefined, locale?: string): string => {
    const d = toDate(date);
    if (!d) return EMPTY_VALUE;

    return new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).format(d);
};

/** A count with its noun: "1 host", "3 hosts". `many` for nouns without a plain -s plural. */
export const plural = (count: number, one: string, many = `${one}s`): string =>
    `${count} ${count === 1 ? one : many}`;

/**
 * How a client is named everywhere: its display name, or its hostname while it has none.
 * `||` rather than `??` on purpose: an empty display name must fall back as well, or the row
 * shows no name at all.
 */
export const clientName = (client: { displayName?: string | null; hostname: string }): string =>
    client.displayName || client.hostname;

export const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};

/**
 * A failure as a notice: the title says what did not happen, the server's message why.
 * For an action that was not asked about first -- one that was reports its failure inside
 * its own dialog instead (see `onConfirm` in useConfirm).
 */
export const describeFailure = (title: string, error: unknown): AlertOptions => ({
    title,
    description: getErrorMessage(error),
});
