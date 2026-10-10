import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "@sadm/shared";
import { clientCount, formatOnlineCount, hostSummary, objectSummary, problemSummary, unseenProblems } from "./dashboard";

const event = (id: string, over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id,
    kind: "scheduler.failed",
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:00.000Z",
    source: "server",
    clientId: "a",
    level: "info",
    seen: false,
    ...over,
});

describe("clientCount", () => {
    it("counts the clients that are online against all of them", () => {
        const clients = [{ status: "online" }, { status: "offline" }, { status: null }];
        expect(clientCount(clients)).toEqual({ online: 1, total: 3 });
        expect(formatOnlineCount(clientCount(clients))).toBe("1/3");
    });

    it("is zero of zero without a client", () => {
        expect(formatOnlineCount(clientCount([]))).toBe("0/0");
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

describe("hostSummary", () => {
    it("says how many domain controllers are away, or that none is", () => {
        expect(hostSummary({ online: 3, total: 3 })).toBe("All connected");
        expect(hostSummary({ online: 1, total: 3 })).toBe("2 offline");
    });

    it("does not call an empty list connected", () => {
        expect(hostSummary({ online: 0, total: 0 })).toBe("No domain controller registered");
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
