import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "@sadm/shared";
import { answeringCount, controllerSummary, formatAnsweringCount, objectSummary, problemSummary, unseenProblems } from "./dashboard";

const event = (id: string, over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id,
    kind: "scheduler.failed",
    occurredAt: "2026-01-01T00:00:00.000Z",
    dcId: "a",
    level: "info",
    seen: false,
    ...over,
});

describe("answeringCount", () => {
    const measured = { collectedAt: "2026-01-01T00:00:00.000Z" } as never;
    const unreachable = { type: "dc-unreachable" } as never;

    it("counts the domain controllers that answered against all of them", () => {
        const controllers = [
            { health: measured, issues: [] },
            { health: measured, issues: [unreachable] },
            { health: null, issues: [] },
        ];
        expect(answeringCount(controllers)).toEqual({ answering: 1, total: 3 });
        expect(formatAnsweringCount(answeringCount(controllers))).toBe("1/3");
    });

    it("counts one with a finding that is not about reaching it", () => {
        expect(answeringCount([{ health: measured, issues: [{ type: "service-down" } as never] }]).answering).toBe(1);
    });

    it("is zero of zero without a domain controller", () => {
        expect(formatAnsweringCount(answeringCount([]))).toBe("0/0");
    });
});

describe("unseenProblems", () => {
    it("counts the unseen rows at warning and above", () => {
        const events = [
            event("a", { level: "error" }),
            event("b", { level: "warning" }),
            event("c", { level: "info" }),
            event("d", { level: "error", seen: true }),
        ];
        expect(unseenProblems(events)).toEqual({ errors: 1, warnings: 1 });
    });

    it("counts a group as one row, at the most severe level in it", () => {
        const events = [
            event("a", { level: "error", correlationId: "i1" }),
            event("b", { level: "warning", correlationId: "i1" }),
        ];
        expect(unseenProblems(events)).toEqual({ errors: 1, warnings: 0 });
    });
});

describe("problemSummary", () => {
    it("names what the number is made of and leaves out a part that is zero", () => {
        expect(problemSummary({ errors: 1, warnings: 2 })).toBe("1 error · 2 warnings");
        expect(problemSummary({ errors: 0, warnings: 1 })).toBe("1 warning");
    });

    it("says so when nothing is unseen", () => {
        expect(problemSummary({ errors: 0, warnings: 0 })).toBe("Nothing unseen");
    });
});

describe("controllerSummary", () => {
    it("says how many domain controllers do not answer, or that all do", () => {
        expect(controllerSummary({ answering: 3, total: 3 })).toBe("All answer");
        expect(controllerSummary({ answering: 1, total: 3 })).toBe("2 not answering");
    });

    it("does not say of an empty list that all answer", () => {
        expect(controllerSummary({ answering: 0, total: 0 })).toBe("None found in the directory yet");
    });
});

describe("objectSummary", () => {
    it("names what the directory holds", () => {
        expect(objectSummary({ users: 1, groups: 38, computers: 2 })).toBe("1 user · 38 groups · 2 computers");
    });

    it("says so while nothing has been counted", () => {
        expect(objectSummary(null)).toBe("Not counted yet");
    });
});
