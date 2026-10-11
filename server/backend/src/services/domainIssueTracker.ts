import type { DomainIssue } from "@sadm/shared";

/** A finding that has been announced and not yet called off. */
export interface OpenIssue {
    id: string;
    type: string;
    severity: string;
    dc: string | null;
    dcId: string | null;
    /** The finding as it was last worded. */
    text: string;
    openedAt: string;
    /** What groups the announcement and the all-clear into one row of the activity list. */
    correlationId: string;
}

export interface TrackerState {
    /** Findings seen and not yet announced, with when they were first seen. */
    appearing: ReadonlyMap<string, number>;
    /** Announced findings that are gone, with when they were first missed. */
    vanishing: ReadonlyMap<string, number>;
}

export const EMPTY_TRACKER_STATE: TrackerState = { appearing: new Map(), vanishing: new Map() };

export interface TrackerStep {
    state: TrackerState;
    /** Findings to announce now. */
    opened: DomainIssue[];
    /** Announced findings to call off now. */
    resolved: OpenIssue[];
    /** Announced findings that are still there under other words: stored, not announced again. */
    reworded: { id: string; text: string }[];
}

/**
 * What to tell about the domain's findings, given what was told before and what is found now.
 *
 * A finding is announced once it has been there for `confirmMs`, and called off once it has
 * been gone that long. Both waits are the point: a service that misses one answer, a
 * replication attempt that fails once and succeeds on the next -- neither is worth a message
 * and its retraction to everybody a webhook reaches. A finding that comes back before it was
 * called off was never gone, and one that goes before it was announced never was there.
 *
 * Pure: `DomainEventService` keeps the state and does the telling.
 */
export function trackIssues(
    state: TrackerState,
    open: readonly OpenIssue[],
    current: readonly DomainIssue[],
    now: number,
    confirmMs: number,
): TrackerStep {
    const found = new Map(current.map((issue) => [issue.id, issue]));
    const announced = new Map(open.map((issue) => [issue.id, issue]));

    const appearing = new Map<string, number>();
    const opened: DomainIssue[] = [];
    for (const issue of current) {
        if (announced.has(issue.id)) continue;
        const since = state.appearing.get(issue.id) ?? now;
        if (now - since >= confirmMs) opened.push(issue);
        else appearing.set(issue.id, since);
    }

    const vanishing = new Map<string, number>();
    const resolved: OpenIssue[] = [];
    const reworded: { id: string; text: string }[] = [];
    for (const issue of open) {
        const still = found.get(issue.id);
        if (still) {
            if (still.text !== issue.text) reworded.push({ id: issue.id, text: still.text });
            continue;
        }
        const since = state.vanishing.get(issue.id) ?? now;
        if (now - since >= confirmMs) resolved.push(issue);
        else vanishing.set(issue.id, since);
    }

    return { state: { appearing, vanishing }, opened, resolved, reworded };
}
