import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "@sadm/shared";
import { paths } from "../../../lib/paths";
import { activityLinks } from "./activityLinks";

const event = (over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id: "e1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    source: "server",
    clientId: "c1",
    kind: "client.connected",
    level: "trace",
    seen: false,
    ...over,
});

describe("activityLinks", () => {
    it("leads to the client the event happened on", () => {
        expect(activityLinks(event(), new Set(["c1"]))).toEqual({ client: paths.client("c1") });
    });

    it("has no target for a client that is gone", () => {
        expect(activityLinks(event(), new Set(["c2"]))).toEqual({});
    });

    it("has no target for an event of the server itself", () => {
        expect(activityLinks(event({ clientId: null }), new Set(["c1"]))).toEqual({});
    });
});
