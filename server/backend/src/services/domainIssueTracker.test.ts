import { describe, expect, it } from "vitest";
import type { DomainIssue, IssueTiming } from "@sadm/shared";
import { reportAt, staleAfterDowntime, trackIssues, type TrackedIssue } from "./domainIssueTracker.js";

const MIN = 60_000;
const T0 = Date.parse("2026-10-15T12:00:00.000Z");

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

/**
 * Runs the tracker over a sequence of evaluations, keeping its rows as the service would,
 * and collects everything it told.
 */
function run(steps: { at: number; found: DomainIssue[] }[], tracked: TrackedIssue[] = [], waits = timing) {
    let rows = [...tracked];
    let next = 0;
    const told: { kind: string; id: string; severity: string; at: number }[] = [];
    for (const { at, found } of steps) {
        const step = trackIssues(rows, found, at, waits, () => `c${++next}`);
        const removed = new Set(step.remove);
        const saved = new Map(step.save.map((row) => [row.id, row]));
        rows = [...rows.filter((row) => !removed.has(row.id) && !saved.has(row.id)), ...saved.values()];
        for (const row of step.opened) told.push({ kind: "opened", id: row.id, severity: row.severity, at });
        for (const row of step.escalated) told.push({ kind: "escalated", id: row.id, severity: row.severity, at });
        for (const row of step.resolved) told.push({ kind: "resolved", id: row.id, severity: row.severity, at });
    }
    return { rows, told };
}

/** One evaluation a minute from T0, for `minutes` minutes, finding what `found` says for each. */
const minutes = (count: number, found: (minute: number) => DomainIssue[]) =>
    Array.from({ length: count }, (_, minute) => ({ at: T0 + minute * MIN, found: found(minute) }));

describe("trackIssues", () => {
    it("keeps a new finding pending, and reports it once it has lasted its wait", () => {
        const { rows, told } = run(minutes(6, () => [issue("x")]));
        expect(told).toEqual([{ kind: "opened", id: "x", severity: "warning", at: T0 + 5 * MIN }]);
        expect(rows[0]).toMatchObject({ state: "open", correlationId: "c1", seenSince: new Date(T0).toISOString() });
    });

    it("waits as long as the kind of finding asks", () => {
        const { told } = run(minutes(3, () => [issue("x", { type: "dc-unreachable" })]));
        expect(told.map((t) => t.at)).toEqual([T0 + 2 * MIN]);
    });

    it("reports at once with no wait", () => {
        const { told, rows } = run(minutes(1, () => [issue("x")]), [], { reportAfterMs: () => 0, resolveAfterMs: 5 * MIN });
        expect(told.map((t) => t.kind)).toEqual(["opened"]);
        expect(rows[0].state).toBe("open");
    });

    it("never reports a finding that goes before its wait is over, and forgets it after the resolve wait", () => {
        const { rows, told } = run(minutes(12, (m) => (m < 3 ? [issue("x")] : [])));
        expect(told).toEqual([]);
        expect(rows).toEqual([]);
    });

    it("bridges a gap shorter than the resolve wait: a finding that comes and goes is still reported", () => {
        // There every other minute: never five minutes in a row, and still a problem.
        const { told } = run(minutes(7, (m) => (m % 2 === 0 ? [issue("x")] : [])));
        expect(told).toEqual([{ kind: "opened", id: "x", severity: "warning", at: T0 + 6 * MIN }]);
    });

    it("starts the wait over after a gap of the resolve wait", () => {
        const { told } = run([
            ...minutes(3, () => [issue("x")]),
            { at: T0 + 8 * MIN, found: [] },
            ...minutes(5, () => [issue("x")]).map((s) => ({ ...s, at: s.at + 9 * MIN })),
        ]);
        expect(told).toEqual([]);
    });

    it("calls a reported finding off once it has been gone for the resolve wait, and not before", () => {
        const { told, rows } = run([
            ...minutes(6, () => [issue("x")]),
            ...minutes(6, () => []).map((s) => ({ ...s, at: s.at + 6 * MIN })),
        ]);
        expect(told.map((t) => [t.kind, (t.at - T0) / MIN])).toEqual([
            ["opened", 5],
            ["resolved", 10],
        ]);
        expect(rows).toEqual([]);
    });

    it("does not call off a reported finding that comes and goes, nor report it again", () => {
        const { told } = run(minutes(20, (m) => (m < 6 || m % 3 === 0 ? [issue("x")] : [])));
        expect(told.map((t) => t.kind)).toEqual(["opened"]);
    });

    it("reports a warning that has been an error for its wait as an error, once", () => {
        const { told, rows } = run(minutes(14, (m) => [issue("x", { severity: m < 6 ? "warning" : "error" })]));
        expect(told.map((t) => [t.kind, t.severity, (t.at - T0) / MIN])).toEqual([
            ["opened", "warning", 5],
            ["escalated", "error", 11],
        ]);
        expect(rows[0]).toMatchObject({ severity: "error", escalatingSince: null, correlationId: "c1" });
    });

    it("lets an error that does not last pass", () => {
        const { told, rows } = run(minutes(12, (m) => [issue("x", { severity: m === 7 || m === 8 ? "error" : "warning" })]));
        expect(told.map((t) => t.kind)).toEqual(["opened"]);
        expect(rows[0]).toMatchObject({ severity: "warning", escalatingSince: null });
    });

    it("goes back to a warning quietly, and tells the next time it becomes an error", () => {
        const severity = (m: number) => (m >= 6 && m < 12) || m >= 14 ? "error" : "warning";
        const { told } = run(minutes(20, (m) => [issue("x", { severity: severity(m) })]));
        expect(told.map((t) => [t.kind, (t.at - T0) / MIN])).toEqual([
            ["opened", 5],
            ["escalated", 11],
            ["escalated", 19],
        ]);
    });

    it("reports a finding that became an error while it waited as an error", () => {
        const { told } = run(minutes(6, (m) => [issue("x", { severity: m < 3 ? "warning" : "error" })]));
        expect(told).toEqual([{ kind: "opened", id: "x", severity: "error", at: T0 + 5 * MIN }]);
    });

    it("keeps the text current without telling", () => {
        const { told, rows } = run(minutes(8, (m) => [issue("x", { text: `failed ${m} times` })]));
        expect(told.map((t) => t.kind)).toEqual(["opened"]);
        expect(rows[0].text).toBe("failed 7 times");
    });
});

describe("staleAfterDowntime", () => {
    const row = (id: string, state: "pending" | "open", lastSeenMinutesAgo: number): TrackedIssue => ({
        id,
        type: "storage-low",
        severity: "warning",
        dc: "DC1",
        dcId: "a",
        text: id,
        state,
        seenSince: new Date(T0 - 60 * MIN).toISOString(),
        lastSeenAt: new Date(T0 - lastSeenMinutesAgo * MIN).toISOString(),
        openedAt: state === "open" ? new Date(T0 - 50 * MIN).toISOString() : null,
        correlationId: state === "open" ? "c" : null,
        escalatingSince: null,
    });

    it("names the pending findings not seen for the resolve wait, and keeps the open ones", () => {
        expect(staleAfterDowntime([row("old", "pending", 30), row("recent", "pending", 1), row("open", "open", 30)], T0, timing)).toEqual([
            "old",
        ]);
    });
});

describe("reportAt", () => {
    it("is the start of a finding plus the wait of its kind", () => {
        expect(reportAt({ type: "dc-unreachable", seenSince: new Date(T0).toISOString() }, timing)).toBe(new Date(T0 + 2 * MIN).toISOString());
    });
});
