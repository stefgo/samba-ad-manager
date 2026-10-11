import { describe, expect, it } from "vitest";
import type { ActivityRecord, DcHealth, SchedulerStatuses } from "@sadm/shared";
import {
    appendActivity,
    applyDcHealth,
    mergeDcHealth,
    applySchedulerUpdate,
    markActivitySeen,
    unmarkActivitySeen,
    unseenAmong,
    unseenTone,
} from "./cacheUpdates";

const measurement = (dcId: string, collectedAt: string, kerberos = true): DcHealth => ({
    dcId,
    collectedAt,
    services: [{ name: "Kerberos", port: 88, check: "protocol", ok: kerberos }],
    errors: [],
});

const event = (id: string, occurredAt: string, seen = false, level: ActivityRecord["level"] = "info"): ActivityRecord => ({
    id,
    occurredAt,
    kind: "future.kind",
    level,
    seen,
});

describe("applyDcHealth", () => {
    const states = { a: measurement("a", "2026-10-04T08:00:00Z"), b: measurement("b", "2026-10-04T08:00:00Z") };

    it("replaces one domain controller's measurement and leaves the others", () => {
        const next = applyDcHealth(states, measurement("a", "2026-10-04T08:01:00Z", false));
        expect(next.a.services[0].ok).toBe(false);
        expect(next.b).toBe(states.b);
    });

    // Sent for every domain controller on connect, before or after the request has answered.
    it("makes the entry when there is none", () => {
        expect(applyDcHealth(undefined, states.a)).toEqual({ a: states.a });
    });

    it("keeps the cached measurement when the one that arrives is older", () => {
        expect(applyDcHealth(states, measurement("a", "2026-10-04T07:59:00Z", false))).toBe(states);
    });

    // The connect burst repeats what the request has just answered.
    it("takes a measurement of the same instant", () => {
        const same = measurement("a", "2026-10-04T08:00:00Z", false);
        expect(applyDcHealth(states, same).a).toBe(same);
    });

    // A database check arrives on the domain controller's schedule, not with a measurement.
    it("takes the same measurement with a database check that was reported since", () => {
        const dbcheck = { checkedAt: "2026-10-04T08:00:20Z", receivedAt: "2026-10-04T08:00:30Z", errors: 0 };
        const reported = { ...states.a, dbcheck };
        expect(applyDcHealth(states, reported).a).toBe(reported);
        // And an answer read before the report must not take it away again.
        expect(applyDcHealth({ ...states, a: reported }, states.a).a).toBe(reported);
    });
});

describe("mergeDcHealth", () => {
    it("turns the answer into an entry by domain controller", () => {
        const a = measurement("a", "2026-10-04T08:00:00Z");
        expect(mergeDcHealth(undefined, [a])).toEqual({ a });
    });

    // The request was under way while the socket delivered the newer measurement.
    it("keeps a measurement the socket delivered after the answer was read", () => {
        const pushed = measurement("a", "2026-10-04T08:00:05Z", false);
        const merged = mergeDcHealth({ a: pushed }, [measurement("a", "2026-10-04T08:00:00Z")]);
        expect(merged.a).toBe(pushed);
    });

    it("keeps a domain controller the answer does not know yet", () => {
        const b = measurement("b", "2026-10-04T08:00:05Z");
        expect(Object.keys(mergeDcHealth({ b }, [measurement("a", "2026-10-04T08:00:00Z")]))).toEqual(["b", "a"]);
    });
});

describe("unseenTone", () => {
    it("is the most severe level among the unseen events", () => {
        const events = [event("a", "1", false, "warning"), event("b", "2", false, "error")];
        expect(unseenTone(events)).toBe("error");
        expect(unseenTone([events[0]])).toBe("warning");
    });

    it("asks for no look at info, trace or anything seen", () => {
        expect(unseenTone([event("a", "1"), event("b", "2", false, "trace"), event("c", "3", true, "error")])).toBeNull();
    });
});

describe("appendActivity", () => {
    const list = [event("b", "2026-10-04T08:00:00Z"), event("a", "2026-10-04T07:00:00Z")];

    it("puts a new event where it happened, not on top", () => {
        const late = event("late", "2026-10-04T07:30:00Z");
        expect(appendActivity(list, [late]).map((e) => e.id)).toEqual(["b", "late", "a"]);
    });

    it("skips an event it already holds", () => {
        expect(appendActivity(list, [event("a", "2026-10-04T07:00:00Z")])).toBe(list);
    });

    it("adds only the new ones of a batch", () => {
        const batch = [event("a", "2026-10-04T07:00:00Z"), event("c", "2026-10-04T09:00:00Z")];
        expect(appendActivity(list, batch).map((e) => e.id)).toEqual(["c", "b", "a"]);
    });
});

describe("marking activity seen", () => {
    const list = [event("a", "2026-10-04T08:00:00Z"), event("b", "2026-10-04T07:00:00Z", true)];

    it("turns the named events seen", () => {
        expect(markActivitySeen(list, ["a"]).map((e) => e.seen)).toEqual([true, true]);
    });

    it("returns the list itself when nothing changes", () => {
        expect(markActivitySeen(list, ["b", "gone"])).toBe(list);
    });

    it("names what a marking will change", () => {
        expect(unseenAmong(list, ["a", "b", "gone"])).toEqual(["a"]);
    });

    // Only what the failed request had turned seen goes back, not what was seen before.
    it("takes back exactly what was marked", () => {
        const marked = markActivitySeen(list, ["a", "b"]);
        const undone = unmarkActivitySeen(marked, unseenAmong(list, ["a", "b"]));
        expect(undone.map((e) => e.seen)).toEqual([false, true]);
    });
});

describe("applySchedulerUpdate", () => {
    const idle = { isRunning: false, nextRun: null, lastRun: null };
    const schedulers: SchedulerStatuses = { "notification-cleanup": idle };

    it("replaces the scheduler the update names", () => {
        const updated = applySchedulerUpdate(schedulers, {
            scheduler: "notification-cleanup",
            status: { ...idle, isRunning: true },
        });
        expect(updated["notification-cleanup"].isRunning).toBe(true);
        expect(schedulers["notification-cleanup"].isRunning).toBe(false);
    });
});
