import { describe, expect, it } from "vitest";
import { activityDetail, activityMessage } from "./activityText.js";
import type { ActivityRecord } from "./types.js";

const event = (kind: string, over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id: "e1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    source: "server",
    clientId: "c1",
    kind,
    level: "info",
    seen: false,
    ...over,
});

describe("activityMessage: the server's events", () => {
    it("names the client that connected or went away", () => {
        expect(activityMessage(event("client.connected", { data: { clientName: "dc1" } }))).toBe("dc1 connected");
        expect(activityMessage(event("client.disconnected", { data: { clientName: "dc1" } }))).toBe(
            "dc1 disconnected",
        );
        expect(activityMessage(event("client.connected"))).toBe("the client connected");
    });

    it("names a registration by the hostname the agent gave", () => {
        expect(activityMessage(event("client.registered", { data: { hostname: "dc2.example.net" } }))).toBe(
            "dc2.example.net registered",
        );
    });

    it("names the scheduler that failed, and why", () => {
        const failed = event("scheduler.failed", { data: { scheduler: "token-cleanup", error: "disk full" } });
        expect(activityMessage(failed)).toBe("Token cleanup failed: disk full");
        expect(activityMessage(event("scheduler.failed", { data: { scheduler: "other" } }))).toBe("other failed");
        expect(activityMessage(event("scheduler.failed"))).toBe("A scheduled job failed");
    });

    it("prints the kind of an event it cannot phrase", () => {
        expect(activityMessage(event("future.kind"))).toBe("future.kind");
    });
});

describe("activityDetail", () => {
    it("is the error an event carries, or nothing", () => {
        expect(activityDetail(event("scheduler.failed", { data: { error: "disk full" } }))).toBe("disk full");
        expect(activityDetail(event("client.connected"))).toBeNull();
    });
});
