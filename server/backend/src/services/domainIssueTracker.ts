import type { DomainIssue, IssueTiming } from "@sadm/shared";

/**
 * A finding the server keeps track of: one waiting to be reported (`pending`), or one that
 * has been and is not yet called off (`open`). Kept in `domain_issues`, so a restart neither
 * starts a wait over nor reports a finding twice.
 */
export interface TrackedIssue {
    id: string;
    type: string;
    /** For an open finding the severity it was reported with; for a pending one the current. */
    severity: string;
    dc: string | null;
    dcId: string | null;
    /** The finding as it was last worded. */
    text: string;
    state: "pending" | "open";
    /** Since when the finding has been there, over gaps shorter than the resolve wait. */
    seenSince: string;
    /** When an evaluation last found it. */
    lastSeenAt: string;
    /** When it was reported; null while pending. */
    openedAt: string | null;
    /** What groups its events into one row of the activity list; null while pending. */
    correlationId: string | null;
    /** Since when an open warning has been an error, while that is not reported yet. */
    escalatingSince: string | null;
}

export interface TrackerStep {
    /** Rows to write: new ones, and ones that changed. */
    save: TrackedIssue[];
    /** Rows to delete, by id. */
    remove: string[];
    /** Findings reported now, as they are saved. */
    opened: TrackedIssue[];
    /** Open findings that have been an error long enough to say so, as they are saved. */
    escalated: TrackedIssue[];
    /** Open findings called off now, as they were stored. */
    resolved: TrackedIssue[];
}

const at = (iso: string): number => Date.parse(iso);

/**
 * What to tell about the domain's findings, given what is tracked and what is found now.
 *
 * - A finding is reported once it has lasted `reportAfterMs` for its kind. Until then it is
 *   `pending` and nobody hears of it but the dashboard.
 * - A gap shorter than `resolveAfterMs` is no gap: a problem that comes and goes with every
 *   other measurement is still reported, and a reported one that does so is not called off
 *   and reported again each time. A pending finding gone for longer is forgotten.
 * - A reported finding is called off once it has been gone for `resolveAfterMs`.
 * - A reported warning that has been an error for `reportAfterMs` is reported again as an
 *   error. One that goes back to a warning does so quietly, so that the next time is told.
 *   A finding reported only after it became an error is reported as one.
 * - A new text alone is saved and not told: it counts failures and minutes.
 *
 * Pure: `DomainEventService` stores the rows and does the telling. `newCorrelationId` is
 * asked once for every finding reported.
 */
export function trackIssues(
    tracked: readonly TrackedIssue[],
    current: readonly DomainIssue[],
    now: number,
    timing: IssueTiming,
    newCorrelationId: () => string,
): TrackerStep {
    const step: TrackerStep = { save: [], remove: [], opened: [], escalated: [], resolved: [] };
    const nowIso = new Date(now).toISOString();
    const found = new Map(current.map((issue) => [issue.id, issue]));
    const known = new Map(tracked.map((row) => [row.id, row]));

    for (const issue of current) {
        const row = known.get(issue.id);
        const reportAfter = timing.reportAfterMs(issue.type);

        if (!row) {
            const pending: TrackedIssue = {
                id: issue.id,
                type: issue.type,
                severity: issue.severity,
                dc: issue.dc ?? null,
                dcId: issue.dcId ?? null,
                text: issue.text,
                state: "pending",
                seenSince: nowIso,
                lastSeenAt: nowIso,
                openedAt: null,
                correlationId: null,
                escalatingSince: null,
            };
            if (reportAfter <= 0) open(pending);
            else step.save.push(pending);
            continue;
        }

        if (row.state === "pending") {
            const next: TrackedIssue = { ...row, severity: issue.severity, text: issue.text, lastSeenAt: nowIso };
            if (now - at(row.seenSince) >= reportAfter) open(next);
            else step.save.push(next);
            continue;
        }

        // Open: the text is kept current, and an error that lasts is told.
        const next: TrackedIssue = { ...row, text: issue.text, lastSeenAt: nowIso };
        if (issue.severity === "error" && row.severity !== "error") {
            next.escalatingSince = row.escalatingSince ?? nowIso;
            if (now - at(next.escalatingSince) >= reportAfter) {
                next.severity = "error";
                next.escalatingSince = null;
                step.escalated.push(next);
            }
        } else {
            next.escalatingSince = null;
            // Lighter now: kept quietly, so that it can become an error again and be told.
            if (issue.severity !== row.severity) next.severity = issue.severity;
        }
        step.save.push(next);
    }

    for (const row of tracked) {
        if (found.has(row.id)) continue;
        if (now - at(row.lastSeenAt) < timing.resolveAfterMs) continue;
        step.remove.push(row.id);
        if (row.state === "open") step.resolved.push(row);
    }

    return step;

    function open(row: TrackedIssue): void {
        const opened: TrackedIssue = {
            ...row,
            state: "open",
            openedAt: nowIso,
            correlationId: newCorrelationId(),
            escalatingSince: null,
        };
        step.save.push(opened);
        step.opened.push(opened);
    }
}

/**
 * The pending findings a server that was down has lost track of: not seen for longer than
 * the resolve wait. Running, it would have forgotten them when they went; whether they went
 * while it was down it cannot say, so their wait starts over. Asked once, on the first
 * evaluation after a start. An open finding stays: it was reported, and only its all-clear
 * can end it.
 */
export function staleAfterDowntime(tracked: readonly TrackedIssue[], now: number, timing: IssueTiming): string[] {
    return tracked
        .filter((row) => row.state === "pending" && now - at(row.lastSeenAt) >= timing.resolveAfterMs)
        .map((row) => row.id);
}

/** When a pending finding is reported if it lasts: its start plus the wait of its kind. */
export const reportAt = (row: Pick<TrackedIssue, "type" | "seenSince">, timing: IssueTiming): string =>
    new Date(at(row.seenSince) + timing.reportAfterMs(row.type)).toISOString();
