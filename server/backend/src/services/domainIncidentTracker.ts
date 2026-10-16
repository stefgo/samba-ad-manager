import type { DomainIssue, IssueTiming } from "@sadm/shared";
import { emptyHistory, withAppeared, withGap, withGone, withSeverity, type IssueHistory } from "./issueHistory.js";

/** The incident of the findings that are about no domain controller: about the domain itself, or a name server. */
export const DOMAIN_INCIDENT = "domain";

/** Which incident a finding belongs to: that of its domain controller, or that of the domain. */
export const incidentKey = (issue: Pick<DomainIssue, "dcId">): string => issue.dcId ?? DOMAIN_INCIDENT;

/**
 * A finding as its incident keeps it.
 *
 * - `pending`: there, and not there long enough to be reported.
 * - `reported`: has lasted the wait of its kind and been told, by the opening of its
 *   incident or as a finding that joined it.
 * - `gone`: has been gone for the resolve wait. Kept, so the incident's events still list it.
 */
export interface TrackedFinding {
    /** `DomainIssue.id`. */
    id: string;
    type: string;
    /** As it was last found. */
    severity: string;
    /** The most severe it has been. */
    worstSeverity: string;
    /** As it was last worded. */
    text: string;
    state: "pending" | "reported" | "gone";
    /** Since when it has been there, over gaps shorter than the resolve wait. */
    since: string;
    /** When an evaluation last found it. */
    lastSeenAt: string;
    /** When an evaluation first missed it, while it is missing. */
    goneSince: string | null;
    /** When it was reported; null until then. */
    reportedAt: string | null;
    /** The severity it was reported with, or last escalated to. */
    reportedSeverity: string | null;
    /** Since when a reported warning has been an error, while that is not reported yet. */
    escalatingSince: string | null;
    /** How often it was gone and came back. */
    gaps: number;
    history: IssueHistory;
}

/**
 * The findings about one domain controller, or about the domain, from the first of them to
 * the moment the last is gone. Reported as a whole: one opening, one all-clear, one row of
 * the activity list, one correlation id.
 */
export interface TrackedIncident {
    /** `dcId`, or `DOMAIN_INCIDENT`. */
    key: string;
    dc: string | null;
    dcId: string | null;
    since: string;
    lastSeenAt: string;
    /** When it was reported; null while none of its findings has been. */
    openedAt: string | null;
    correlationId: string | null;
    findings: TrackedFinding[];
}

export type IncidentEventKind = "opened" | "extended" | "escalated" | "resolved" | "discarded";

export interface IncidentEvent {
    kind: IncidentEventKind;
    /** The incident as this evaluation leaves it; as it ended, for the last two kinds. */
    incident: TrackedIncident;
    /** The findings reported now (opened, extended) or now reported as an error (escalated). */
    findings: TrackedFinding[];
}

export interface IncidentStep {
    /** The incidents that go on. */
    incidents: TrackedIncident[];
    events: IncidentEvent[];
}

const at = (iso: string): number => Date.parse(iso);

const worse = (a: string, b: string): string => (a === "error" || b === "error" ? "error" : a);

function newFinding(issue: DomainIssue, nowIso: string): TrackedFinding {
    return {
        id: issue.id,
        type: issue.type,
        severity: issue.severity,
        worstSeverity: issue.severity,
        text: issue.text,
        state: "pending",
        since: nowIso,
        lastSeenAt: nowIso,
        goneSince: null,
        reportedAt: null,
        reportedSeverity: null,
        escalatingSince: null,
        gaps: 0,
        history: withAppeared(emptyHistory(), nowIso, issue.severity, issue.text),
    };
}

/** A finding that was gone and is there again: a new one, with what it went through before. */
function revived(finding: TrackedFinding, issue: DomainIssue, nowIso: string): TrackedFinding {
    return {
        ...newFinding(issue, nowIso),
        worstSeverity: worse(finding.worstSeverity, issue.severity),
        gaps: finding.gaps,
        history: withAppeared(finding.history, nowIso, issue.severity, issue.text),
    };
}

/** A finding found again: a gap that ended, a severity that changed, the latest text. */
function sighted(finding: TrackedFinding, issue: DomainIssue, nowIso: string): TrackedFinding {
    let history = finding.history;
    let gaps = finding.gaps;
    if (finding.goneSince) {
        history = withGap(history, finding.goneSince, nowIso);
        gaps++;
    }
    // A new text alone is not history: it counts failures and minutes.
    if (issue.severity !== finding.severity) history = withSeverity(history, nowIso, issue.severity, issue.text);
    return {
        ...finding,
        type: issue.type,
        severity: issue.severity,
        worstSeverity: worse(finding.worstSeverity, issue.severity),
        text: issue.text,
        lastSeenAt: nowIso,
        goneSince: null,
        gaps,
        history,
    };
}

/**
 * What to tell about the domain's incidents, given what is tracked and what is found now.
 *
 * - A finding belongs to the incident of its domain controller, one about no domain
 *   controller to that of the domain.
 * - A finding is reported once it has lasted `reportAfterMs` for its kind. The first that is
 *   opens its incident; one reported after that joins it (`extended`).
 * - A gap shorter than `resolveAfterMs` is no gap: a problem that comes and goes with every
 *   other measurement is still reported, and the gap is counted in its history. A finding
 *   gone for longer is gone, and stays in its incident as such.
 * - A reported warning that has been an error for `reportAfterMs` is reported again as an
 *   error. One that goes back to a warning does so quietly, so that the next time is told.
 * - An incident ends when every finding of it is gone: with the all-clear if it was reported,
 *   discarded if not.
 *
 * Pure: `DomainEventService` keeps the incidents and does the telling. `newCorrelationId` is
 * asked once for every incident reported.
 */
export function trackIncidents(
    incidents: readonly TrackedIncident[],
    current: readonly DomainIssue[],
    now: number,
    timing: IssueTiming,
    newCorrelationId: () => string,
): IncidentStep {
    const nowIso = new Date(now).toISOString();
    const byKey = new Map(incidents.map((incident) => [incident.key, { ...incident, findings: [...incident.findings] }]));
    const found = new Set<string>();

    for (const issue of current) {
        const key = incidentKey(issue);
        let incident = byKey.get(key);
        if (!incident) {
            incident = {
                key,
                dc: issue.dc ?? null,
                dcId: issue.dcId ?? null,
                since: nowIso,
                lastSeenAt: nowIso,
                openedAt: null,
                correlationId: null,
                findings: [],
            };
            byKey.set(key, incident);
        }
        incident.lastSeenAt = nowIso;
        if (issue.dc) incident.dc = issue.dc;
        found.add(issue.id);

        const index = incident.findings.findIndex((finding) => finding.id === issue.id);
        const finding = incident.findings[index];
        if (!finding) incident.findings.push(newFinding(issue, nowIso));
        else incident.findings[index] = finding.state === "gone" ? revived(finding, issue, nowIso) : sighted(finding, issue, nowIso);
    }

    const step: IncidentStep = { incidents: [], events: [] };
    for (const incident of byKey.values()) {
        const reported: TrackedFinding[] = [];
        const escalated: TrackedFinding[] = [];

        incident.findings = incident.findings.map((finding) => {
            if (finding.state === "gone") return finding;

            if (!found.has(finding.id)) {
                if (now - at(finding.lastSeenAt) >= timing.resolveAfterMs) {
                    return {
                        ...finding,
                        state: "gone",
                        goneSince: null,
                        escalatingSince: null,
                        history: withGone(finding.history, finding.goneSince ?? nowIso),
                    };
                }
                return finding.goneSince ? finding : { ...finding, goneSince: nowIso };
            }

            const wait = timing.reportAfterMs(finding.type);
            if (finding.state === "pending") {
                if (now - at(finding.since) < wait) return finding;
                const next: TrackedFinding = { ...finding, state: "reported", reportedAt: nowIso, reportedSeverity: finding.severity };
                reported.push(next);
                return next;
            }

            if (finding.severity === "error" && finding.reportedSeverity !== "error") {
                const escalatingSince = finding.escalatingSince ?? nowIso;
                if (now - at(escalatingSince) < wait) return { ...finding, escalatingSince };
                const next: TrackedFinding = { ...finding, reportedSeverity: "error", escalatingSince: null };
                escalated.push(next);
                return next;
            }
            // Lighter now: kept quietly, so that it can become an error again and be told.
            return { ...finding, reportedSeverity: finding.severity, escalatingSince: null };
        });

        if (reported.length > 0) {
            if (incident.openedAt === null) {
                incident.openedAt = nowIso;
                incident.correlationId = newCorrelationId();
                step.events.push({ kind: "opened", incident, findings: reported });
            } else {
                step.events.push({ kind: "extended", incident, findings: reported });
            }
        }
        if (escalated.length > 0) step.events.push({ kind: "escalated", incident, findings: escalated });

        if (incident.findings.some((finding) => finding.state !== "gone")) {
            step.incidents.push(incident);
        } else {
            step.events.push({ kind: incident.openedAt === null ? "discarded" : "resolved", incident, findings: [] });
        }
    }
    return step;
}

/** When a pending finding is reported if it lasts: its start plus the wait of its kind. */
export const reportAt = (finding: Pick<TrackedFinding, "type" | "since">, timing: IssueTiming): string =>
    new Date(at(finding.since) + timing.reportAfterMs(finding.type)).toISOString();

/** How bad an event is: of the findings it reports, or, at the end, the worst its incident had. */
export function eventSeverity(event: IncidentEvent): string {
    switch (event.kind) {
        case "opened":
        case "extended":
            return event.findings.reduce((worst, finding) => worse(worst, finding.reportedSeverity ?? finding.severity), "warning");
        case "escalated":
            return "error";
        case "resolved":
        case "discarded": {
            const counted = event.kind === "resolved" ? event.incident.findings.filter((f) => f.reportedAt !== null) : event.incident.findings;
            return counted.reduce((worst, finding) => worse(worst, finding.worstSeverity), "warning");
        }
    }
}

/** A finding as the events of its incident list it, for the activity and the webhooks. */
export const findingFacts = (finding: TrackedFinding): Record<string, unknown> => ({
    type: finding.type,
    severity: finding.severity,
    worstSeverity: finding.worstSeverity,
    text: finding.text,
    state: finding.state,
    since: finding.since,
    lastSeenAt: finding.lastSeenAt,
    reportedAt: finding.reportedAt,
    gaps: finding.gaps,
    history: finding.history.entries,
    historyOmitted: finding.history.omitted,
});

const seconds = (ms: number): number => Math.max(0, Math.round(ms / 1000));

/**
 * What an event says about its incident: every finding it had, with what happened to each,
 * and those the event is about. The same shape for every kind, so a webhook template that
 * lists the findings works for all of them.
 */
export function incidentFacts(event: IncidentEvent, now: number): Record<string, unknown> {
    const { incident } = event;
    const facts: Record<string, unknown> = {
        dc: incident.dc,
        severity: eventSeverity(event),
        since: incident.since,
        openedAt: incident.openedAt,
    };
    if (event.kind === "opened" || event.kind === "extended") facts.reported = event.findings.map(findingFacts);
    if (event.kind === "escalated") facts.escalated = event.findings.map(findingFacts);
    // How long the problem lasted, not how long it was reported; a discarded one, as long as it was seen.
    if (event.kind === "resolved") facts.durationSeconds = seconds(now - at(incident.since));
    if (event.kind === "discarded") facts.durationSeconds = seconds(at(incident.lastSeenAt) - at(incident.since));
    facts.findings = incident.findings.map(findingFacts);
    return facts;
}
