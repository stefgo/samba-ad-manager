/**
 * What happened to a finding while the server watched it, as the events of its incident tell
 * it. Kept in memory only: after a restart a finding's history begins again.
 *
 * A finding that comes and goes with every round of measurements would write a line per round.
 * Like the activity list does with repeated rows, an entry of the same kind as the one before
 * it is folded into that one and counted instead -- so what grows the history is a change of
 * what happens, not the number of rounds.
 */
export type IssueHistoryEntry =
    | { change: "appeared"; at: string; severity: string; text: string }
    /** The severity changed `count` times between `first` and `last`; `severity` and `text` are the latest. */
    | { change: "severity"; first: string; last: string; count: number; severity: string; text: string }
    /** It was gone and came back `count` times; `first` and `last` are when the first and the last gap began. */
    | { change: "gap"; first: string; last: string; count: number; longestSeconds: number }
    | { change: "gone"; at: string };

export interface IssueHistory {
    entries: IssueHistoryEntry[];
    /** How many entries were dropped from the middle to keep the history within bounds. */
    omitted: number;
}

/**
 * How many entries are kept from the beginning and from the end. Folding keeps a history short
 * unless gaps and changes of severity take turns; then the middle goes, and the beginning --
 * how it started -- and the end -- how it stands -- remain.
 */
export const HISTORY_HEAD = 10;
export const HISTORY_TAIL = 10;

export const emptyHistory = (): IssueHistory => ({ entries: [], omitted: 0 });

function append(history: IssueHistory, entry: IssueHistoryEntry): IssueHistory {
    const entries = [...history.entries, entry];
    let omitted = history.omitted;
    while (entries.length > HISTORY_HEAD + HISTORY_TAIL) {
        entries.splice(HISTORY_HEAD, 1);
        omitted++;
    }
    return { entries, omitted };
}

/** The finding was found for the first time, or again after it had been called gone. */
export const withAppeared = (history: IssueHistory, at: string, severity: string, text: string): IssueHistory =>
    append(history, { change: "appeared", at, severity, text });

/** The finding is now of another severity. */
export function withSeverity(history: IssueHistory, at: string, severity: string, text: string): IssueHistory {
    const last = history.entries[history.entries.length - 1];
    if (last?.change === "severity") {
        const folded = { ...last, last: at, count: last.count + 1, severity, text };
        return { ...history, entries: [...history.entries.slice(0, -1), folded] };
    }
    return append(history, { change: "severity", first: at, last: at, count: 1, severity, text });
}

/** The finding was gone from `goneAt` and is back at `backAt`. */
export function withGap(history: IssueHistory, goneAt: string, backAt: string): IssueHistory {
    const seconds = Math.max(0, Math.round((Date.parse(backAt) - Date.parse(goneAt)) / 1000));
    const last = history.entries[history.entries.length - 1];
    if (last?.change === "gap") {
        const folded = { ...last, last: goneAt, count: last.count + 1, longestSeconds: Math.max(last.longestSeconds, seconds) };
        return { ...history, entries: [...history.entries.slice(0, -1), folded] };
    }
    return append(history, { change: "gap", first: goneAt, last: goneAt, count: 1, longestSeconds: seconds });
}

/** The finding has been gone long enough to be called gone. */
export const withGone = (history: IssueHistory, at: string): IssueHistory => append(history, { change: "gone", at });
