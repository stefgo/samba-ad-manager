import { describe, expect, it } from "vitest";
import type { DomainIssue, IssueTiming } from "@sadm/shared";
import { emptyHistory } from "./issueHistory.js";
import {
    eventSeverity,
    incidentFacts,
    reportAt,
    trackIncidents,
    type IncidentEvent,
    type TrackedIncident,
} from "./domainIncidentTracker.js";

const MIN = 60_000;
const T0 = Date.parse("2026-10-15T12:00:00.000Z");
const iso = (minute: number) => new Date(T0 + minute * MIN).toISOString();

/** Five minutes to report and to call off, two for `dc-unreachable`. */
const timing: IssueTiming = {
    reportAfterMs: (type) => (type === "dc-unreachable" ? 2 : 5) * MIN,
    resolveAfterMs: 5 * MIN,
};

const issue = (id: string, over: Partial<DomainIssue> = {}): DomainIssue => ({
    id,
    type: "storage-low",
    severity: "warning",
    dc: "DC1",
    dcId: "a",
    text: `${id} is wrong`,
    ...over,
});

interface Told {
    kind: string;
    incident: string;
    ids: string[];
    severity: string;
    at: number;
    event: IncidentEvent;
}

/**
 * Runs the tracker over a sequence of evaluations, keeping its incidents as the service
 * would, and collects everything it told.
 */
function run(steps: { at: number; found: DomainIssue[] }[], start: TrackedIncident[] = [], waits = timing) {
    let incidents = start;
    let next = 0;
    const told: Told[] = [];
    for (const { at, found } of steps) {
        const step = trackIncidents(incidents, found, at, waits, () => `c${++next}`);
        incidents = step.incidents;
        for (const event of step.events) {
            told.push({
                kind: event.kind,
                incident: event.incident.key,
                ids: event.findings.map((f) => f.id),
                severity: eventSeverity(event),
                at: (at - T0) / MIN,
                event,
            });
        }
    }
    return { incidents, told };
}

/** One evaluation a minute from T0, for `count` minutes, finding what `found` says for each. */
const minutes = (count: number, found: (minute: number) => DomainIssue[], from = 0) =>
    Array.from({ length: count }, (_, i) => ({ at: T0 + (from + i) * MIN, found: found(from + i) }));

const brief = (told: Told[]) => told.map((t) => [t.kind, t.at, ...t.ids]);

describe("trackIncidents: when a finding is reported", () => {
    it("keeps a new finding pending, and opens its incident once it has lasted its wait", () => {
        const { incidents, told } = run(minutes(6, () => [issue("x")]));
        expect(brief(told)).toEqual([["opened", 5, "x"]]);
        expect(incidents[0]).toMatchObject({ key: "a", dc: "DC1", openedAt: iso(5), correlationId: "c1", since: iso(0) });
        expect(incidents[0].findings[0]).toMatchObject({ state: "reported", reportedAt: iso(5), reportedSeverity: "warning" });
    });

    it("waits as long as the kind of finding asks", () => {
        const { told } = run(minutes(3, () => [issue("x", { type: "dc-unreachable" })]));
        expect(told.map((t) => t.at)).toEqual([2]);
    });

    it("reports at once with no wait", () => {
        const { told } = run(minutes(1, () => [issue("x")]), [], { reportAfterMs: () => 0, resolveAfterMs: 5 * MIN });
        expect(brief(told)).toEqual([["opened", 0, "x"]]);
    });

    it("bridges a gap shorter than the resolve wait: a finding that comes and goes is still reported", () => {
        // There every other minute: never five minutes in a row, and still a problem.
        const { told } = run(minutes(7, (m) => (m % 2 === 0 ? [issue("x")] : [])));
        expect(brief(told)).toEqual([["opened", 6, "x"]]);
        expect(told[0].event.findings[0]).toMatchObject({ gaps: 3 });
    });

    it("starts the wait over after a gap of the resolve wait", () => {
        const { told } = run([
            ...minutes(3, () => [issue("x")]),
            { at: T0 + 8 * MIN, found: [] },
            ...minutes(5, () => [issue("x")], 9),
        ]);
        expect(told.map((t) => t.kind)).toEqual(["discarded"]);
    });

    it("reports a finding that became an error while it waited as an error", () => {
        const { told } = run(minutes(6, (m) => [issue("x", { severity: m < 3 ? "warning" : "error" })]));
        expect(told.map((t) => [t.kind, t.severity])).toEqual([["opened", "error"]]);
    });
});

describe("trackIncidents: one incident per domain controller", () => {
    it("opens one incident for the findings of one domain controller that last together", () => {
        const { told } = run(minutes(6, () => [issue("x"), issue("y")]));
        expect(brief(told)).toEqual([["opened", 5, "x", "y"]]);
    });

    it("keeps the domain controllers apart", () => {
        const { told } = run(minutes(6, () => [issue("x"), issue("y", { dc: "DC2", dcId: "b" })]));
        expect(told.map((t) => [t.kind, t.incident])).toEqual([
            ["opened", "a"],
            ["opened", "b"],
        ]);
        expect(told[0].event.incident.correlationId).not.toBe(told[1].event.incident.correlationId);
    });

    it("puts the findings about no domain controller in the incident of the domain", () => {
        const { told } = run(minutes(6, () => [issue("x", { dc: undefined, dcId: undefined }), issue("y", { dc: undefined, dcId: undefined })]));
        expect(told.map((t) => [t.kind, t.incident, t.event.incident.dc])).toEqual([["opened", "domain", null]]);
    });

    it("tells of a finding that joins a reported incident, under the same correlation id", () => {
        const { told } = run(minutes(12, (m) => (m < 3 ? [issue("x")] : [issue("x"), issue("y")])));
        expect(brief(told)).toEqual([
            ["opened", 5, "x"],
            ["extended", 8, "y"],
        ]);
        expect(told[1].event.incident.correlationId).toBe("c1");
    });

    it("lists the findings still waiting in the opening", () => {
        const { told } = run(minutes(6, (m) => (m < 3 ? [issue("x")] : [issue("x"), issue("y")])));
        expect(told[0].event.incident.findings.map((f) => [f.id, f.state])).toEqual([
            ["x", "reported"],
            ["y", "pending"],
        ]);
    });

    it("says nothing when a reported finding goes while another stays, and keeps it in the incident", () => {
        const { told, incidents } = run(minutes(20, (m) => (m < 8 ? [issue("x"), issue("y")] : [issue("y")])));
        expect(told.map((t) => t.kind)).toEqual(["opened"]);
        expect(incidents[0].findings.map((f) => [f.id, f.state])).toEqual([
            ["x", "gone"],
            ["y", "reported"],
        ]);
    });

    it("calls the incident off once every finding has been gone for the resolve wait, and not before", () => {
        const { told, incidents } = run(minutes(20, (m) => (m < 6 ? [issue("x"), issue("y")] : m < 9 ? [issue("y")] : [])));
        expect(brief(told)).toEqual([
            ["opened", 5, "x", "y"],
            ["resolved", 13],
        ]);
        expect(incidents).toEqual([]);
        expect(incidentFacts(told[1].event, T0 + 13 * MIN)).toMatchObject({ durationSeconds: 13 * 60, severity: "warning" });
    });

    it("does not call off an incident whose finding comes and goes, nor report it again", () => {
        const { told } = run(minutes(20, (m) => (m < 6 || m % 3 === 0 ? [issue("x")] : [])));
        expect(told.map((t) => t.kind)).toEqual(["opened"]);
    });

    it("discards an incident that was over before anything in it was reported", () => {
        const { told, incidents } = run(minutes(12, (m) => (m < 3 ? [issue("x"), issue("y", { severity: "error" })] : [])));
        expect(brief(told)).toEqual([["discarded", 7]]);
        expect(incidents).toEqual([]);
        const facts = incidentFacts(told[0].event, T0 + 7 * MIN);
        expect(facts).toMatchObject({ openedAt: null, durationSeconds: 120, severity: "error" });
        expect((facts.findings as { state: string }[]).map((f) => f.state)).toEqual(["gone", "gone"]);
    });
});

describe("trackIncidents: escalation", () => {
    it("reports a warning that has been an error for its wait as an error, once", () => {
        const { told, incidents } = run(minutes(14, (m) => [issue("x", { severity: m < 6 ? "warning" : "error" })]));
        expect(told.map((t) => [t.kind, t.severity, t.at])).toEqual([
            ["opened", "warning", 5],
            ["escalated", "error", 11],
        ]);
        expect(incidents[0].findings[0]).toMatchObject({ reportedSeverity: "error", escalatingSince: null });
    });

    it("lets an error that does not last pass", () => {
        const { told, incidents } = run(minutes(12, (m) => [issue("x", { severity: m === 7 || m === 8 ? "error" : "warning" })]));
        expect(told.map((t) => t.kind)).toEqual(["opened"]);
        expect(incidents[0].findings[0]).toMatchObject({ reportedSeverity: "warning", escalatingSince: null });
    });

    it("goes back to a warning quietly, and tells the next time it becomes an error", () => {
        const severity = (m: number) => ((m >= 6 && m < 12) || m >= 14 ? "error" : "warning");
        const { told } = run(minutes(20, (m) => [issue("x", { severity: severity(m) })]));
        expect(told.map((t) => [t.kind, t.at])).toEqual([
            ["opened", 5],
            ["escalated", 11],
            ["escalated", 19],
        ]);
    });
});

describe("trackIncidents: what a finding went through", () => {
    it("keeps the text current and records a change of severity and the gaps, folded", () => {
        const found = (m: number) =>
            m === 1 || m === 2 ? [] : [issue("x", { severity: m >= 4 ? "error" : "warning", text: `failed ${m} times` })];
        const { told } = run(minutes(6, found));
        const finding = told[0].event.findings[0];
        expect(finding.text).toBe("failed 5 times");
        expect(finding.worstSeverity).toBe("error");
        expect(finding.history.entries).toEqual([
            { change: "appeared", at: iso(0), severity: "warning", text: "failed 0 times" },
            { change: "gap", first: iso(1), last: iso(1), count: 1, longestSeconds: 120 },
            { change: "severity", first: iso(4), last: iso(4), count: 1, severity: "error", text: "failed 4 times" },
        ]);
    });

    it("ends the history of a finding that went with when it was first missed", () => {
        const { told } = run(minutes(12, (m) => (m < 3 ? [issue("x")] : [])));
        expect(told[0].event.incident.findings[0].history.entries.at(-1)).toEqual({ change: "gone", at: iso(3) });
    });

    it("takes a finding that comes back after it was gone as a new one, with its past", () => {
        const { incidents } = run(minutes(12, (m) => (m < 9 ? [issue("y")] : []).concat(m < 2 || m >= 9 ? [issue("x")] : [])));
        const x = incidents[0].findings.find((f) => f.id === "x");
        expect(x).toMatchObject({ state: "pending", since: iso(9) });
        expect(x?.history.entries.map((e) => e.change)).toEqual(["appeared", "gone", "appeared"]);
    });
});

describe("trackIncidents: after a restart", () => {
    /** An incident as the repository gives it back: reported, with its reported findings and no history. */
    const stored = (): TrackedIncident => ({
        key: "a",
        dc: "DC1",
        dcId: "a",
        since: iso(-30),
        lastSeenAt: iso(-1),
        openedAt: iso(-25),
        correlationId: "stored",
        findings: [
            {
                id: "x",
                type: "storage-low",
                severity: "warning",
                worstSeverity: "warning",
                text: "x is wrong",
                state: "reported",
                since: iso(-30),
                lastSeenAt: iso(-1),
                goneSince: null,
                reportedAt: iso(-25),
                reportedSeverity: "warning",
                escalatingSince: null,
                gaps: 0,
                history: emptyHistory(),
            },
        ],
    });

    it("neither opens a stored incident again nor reports its findings twice", () => {
        const { told } = run(minutes(10, () => [issue("x")]), [stored()]);
        expect(told).toEqual([]);
    });

    it("calls a stored incident off under its stored correlation id", () => {
        const { told } = run(minutes(6, () => []), [stored()]);
        expect(told.map((t) => [t.kind, t.event.incident.correlationId])).toEqual([["resolved", "stored"]]);
    });
});

describe("reportAt", () => {
    it("is the start of a finding plus the wait of its kind", () => {
        expect(reportAt({ type: "dc-unreachable", since: iso(0) }, timing)).toBe(iso(2));
    });
});
