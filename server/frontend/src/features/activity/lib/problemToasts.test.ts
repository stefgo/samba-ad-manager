import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "@sadm/shared";
import { problemToasts, toastKey } from "./problemToasts";

const event = (id: string, over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id,
    kind: "scheduler.failed",
    occurredAt: "2026-01-01T00:00:00.000Z",
    dcId: "a",
    level: "error",
    seen: false,
    data: { dcName: "DC1" },
    ...over,
});

const none = new Set<string>();

describe("toastKey", () => {
    it("is the incident of an event that belongs to one, else the event", () => {
        expect(toastKey(event("a"))).toBe("a");
        expect(toastKey(event("a", { correlationId: "i1" }))).toBe("i1");
    });
});

describe("problemToasts", () => {
    it("reports an unseen error and lets it stay", () => {
        const [toast, ...rest] = problemToasts([event("a")], none);
        expect(rest).toEqual([]);
        expect(toast.variant).toBe("error");
        expect(toast.sticky).toBe(true);
        expect(toast.title.startsWith("DC1: ")).toBe(true);
    });

    it("reports a warning that goes by itself", () => {
        const [toast] = problemToasts([event("a", { level: "warning" })], none);
        expect(toast.variant).toBe("warning");
        expect(toast.sticky).toBe(false);
    });

    it("reports neither info nor trace, nor what has been seen", () => {
        const events = [event("a", { level: "info" }), event("b", { level: "trace" }), event("c", { seen: true })];
        expect(problemToasts(events, none)).toEqual([]);
    });

    it("reports nothing that was in the list before", () => {
        expect(problemToasts([event("a")], new Set(["a"]))).toEqual([]);
    });

    it("reports an incident once, by its oldest problem", () => {
        // Newest first, as the list is.
        const events = [
            event("b", { correlationId: "i1", kind: "job.step", level: "warning" }),
            event("a", { correlationId: "i1", kind: "job.started", level: "error" }),
        ];
        const toasts = problemToasts(events, none);
        expect(toasts).toHaveLength(1);
        expect(toasts[0].variant).toBe("error");
    });

    it("does not report a later step of an incident that was reported", () => {
        const events = [event("b", { correlationId: "i1", kind: "job.step" })];
        expect(problemToasts(events, new Set(["i1"]))).toEqual([]);
    });

    it("lists the oldest first", () => {
        const events = [event("b", { kind: "dc.removed" }), event("a", { kind: "scheduler.failed" })];
        const [first, second] = problemToasts(events, none);
        expect(first.title).not.toBe(second.title);
        expect(first).toEqual(problemToasts([events[1]], none)[0]);
    });

    it("counts them in one toast when there are more than three", () => {
        const events = [
            event("a"),
            event("b", { level: "warning" }),
            event("c", { level: "warning" }),
            event("d", { level: "warning" }),
        ];
        expect(problemToasts(events, none)).toEqual([
            { variant: "error", title: "4 new problems", description: "1 error · 3 warnings", sticky: true },
        ]);
    });
});
