import { describe, expect, it } from "vitest";
import type { ActivityRecord, SchedulerStatuses } from "@sadm/shared";
import {
    appendActivity,
    applySchedulerUpdate,
    markActivitySeen,
    unmarkActivitySeen,
    unseenAmong,
    unseenTone,
} from "./cacheUpdates";

const event = (id: string, occurredAt: string, seen = false, level: ActivityRecord["level"] = "info"): ActivityRecord => ({
    id,
    occurredAt,
    receivedAt: occurredAt,
    source: "agent",
    kind: "future.kind",
    level,
    seen,
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
    const schedulers: SchedulerStatuses = { "notification-cleanup": idle, "token-cleanup": idle };

    it("replaces the one scheduler and leaves the other", () => {
        const updated = applySchedulerUpdate(schedulers, {
            scheduler: "token-cleanup",
            status: { ...idle, isRunning: true },
        });
        expect(updated["token-cleanup"].isRunning).toBe(true);
        expect(updated["notification-cleanup"]).toBe(schedulers["notification-cleanup"]);
    });
});
