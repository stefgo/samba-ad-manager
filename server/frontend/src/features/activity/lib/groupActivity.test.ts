import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "@sadm/shared";
import { groupActivity, supersededIds } from "./groupActivity";

let clock = 0;

/** Events are created oldest first; the lists under test are newest first, as the API sends them. */
const event = (id: string, kind: string, over: Partial<ActivityRecord> = {}): ActivityRecord => {
    clock += 1;
    const at = new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
    return {
        id,
        kind,
        occurredAt: at,
        dcId: "d1",
        level: "info",
        seen: true,
        ...over,
    };
};

const newestFirst = (...events: ActivityRecord[]) => [...events].reverse();

/** The rows as ids: the head, then its members. */
const rows = (events: ActivityRecord[]) =>
    groupActivity(events).map((group) => [group.head.id, ...group.members.map((member) => member.id)]);

describe("groupActivity", () => {
    it("is empty for an empty list", () => {
        expect(groupActivity([])).toEqual([]);
    });

    it("makes a row of its own of every event without a correlationId, in the order given", () => {
        const a = event("a", "dc.discovered");
        const b = event("b", "scheduler.failed", { level: "warning", seen: false });
        expect(groupActivity(newestFirst(a, b))).toEqual([
            { head: b, members: [], level: "warning", unseen: true, superseded: [] },
            { head: a, members: [], level: "info", unseen: false, superseded: [] },
        ]);
    });

    it("treats a null correlationId like none", () => {
        const a = event("a", "dc.discovered", { correlationId: null });
        const b = event("b", "dc.removed", { correlationId: null });
        expect(rows(newestFirst(a, b))).toEqual([["b"], ["a"]]);
    });

    it("folds the events of one correlationId into one row, read oldest first", () => {
        const opened = event("o", "job.started", { correlationId: "i1" });
        const updated = event("u", "job.step", { correlationId: "i1" });
        const resolved = event("r", "job.finished", { correlationId: "i1" });
        expect(rows(newestFirst(opened, updated, resolved))).toEqual([["o", "u", "r"]]);
    });

    it("keeps a group of one as a row without members", () => {
        const opened = event("o", "job.started", { correlationId: "i1" });
        expect(rows([opened])).toEqual([["o"]]);
    });

    it("keeps a group where its newest member stands, among the other rows", () => {
        const opened = event("o", "job.started", { correlationId: "i1" });
        const between = event("b", "dc.discovered");
        const resolved = event("r", "job.finished", { correlationId: "i1" });
        const after = event("a", "dc.removed");
        expect(rows(newestFirst(opened, between, resolved, after))).toEqual([["a"], ["o", "r"], ["b"]]);
    });

    it("keeps two groups apart that overlap in time", () => {
        const first = event("o1", "job.started", { correlationId: "i1" });
        const second = event("o2", "job.started", { correlationId: "i2" });
        const firstDone = event("r1", "job.finished", { correlationId: "i1" });
        const secondDone = event("r2", "job.finished", { correlationId: "i2" });
        expect(rows(newestFirst(first, second, firstDone, secondDone))).toEqual([
            ["o2", "r2"],
            ["o1", "r1"],
        ]);
    });

    it("colours a group by its most severe member", () => {
        const opened = event("o", "job.started", { correlationId: "i1", level: "warning" });
        const updated = event("u", "job.step", { correlationId: "i1", level: "error" });
        const resolved = event("r", "job.finished", { correlationId: "i1", level: "info" });
        expect(groupActivity(newestFirst(opened, updated, resolved))[0].level).toBe("error");
    });

    it("counts a group as unseen while any of its members is", () => {
        const opened = event("o", "job.started", { correlationId: "i1" });
        const resolved = event("r", "job.finished", { correlationId: "i1", seen: false });
        expect(groupActivity(newestFirst(opened, resolved))[0].unseen).toBe(true);
        expect(groupActivity(newestFirst(opened, { ...resolved, seen: true }))[0].unseen).toBe(false);
    });

    it("heads a group with the event that sums it up, once that has arrived", () => {
        const requested = event("q", "agent.dbcheck_fix_requested", { correlationId: "f1" });
        const attempt = event("t", "agent.dbcheck_fix_attempted", { correlationId: "f1", level: "trace" });
        expect(rows(newestFirst(requested, attempt))).toEqual([["q", "t"]]);
        const fixed = event("f", "agent.dbcheck_fixed", { correlationId: "f1", level: "warning" });
        expect(rows(newestFirst(requested, attempt, fixed))).toEqual([["f", "q", "t"]]);
    });

    it("hides a late warning once the outcome it waited for has arrived, and keeps it for marking seen", () => {
        const requested = event("q", "agent.replication_sync_requested", { correlationId: "s1" });
        const late = event("l", "agent.replication_sync_unconfirmed", { correlationId: "s1", level: "warning", seen: false });
        const [waiting] = groupActivity(newestFirst(requested, late));
        expect(waiting.level).toBe("warning");
        expect(waiting.superseded).toEqual([]);

        const synced = event("s", "agent.replication_synced", { correlationId: "s1", level: "info" });
        const [settled] = groupActivity(newestFirst(requested, late, synced));
        expect([settled.head.id, ...settled.members.map((m) => m.id)]).toEqual(["s", "q"]);
        expect(settled.level).toBe("info");
        expect(settled.superseded.map((e) => e.id)).toEqual(["l"]);
    });

    it("does not let the outcome of one operation settle another", () => {
        const late = event("l", "agent.dbcheck_fix_unconfirmed", { correlationId: "f1", level: "warning" });
        const other = event("o", "agent.dbcheck_fixed", { correlationId: "f2" });
        expect(supersededIds(newestFirst(late, other))).toEqual(new Set());
    });
});
