import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "@sadm/shared";
import { paths } from "../../../lib/paths";
import { activityLinks } from "./activityLinks";

const event = (over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id: "e1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    dcId: "d1",
    kind: "domain.issue_opened",
    level: "error",
    seen: false,
    ...over,
});

describe("activityLinks", () => {
    it("leads to the domain controller the event is about", () => {
        expect(activityLinks(event(), new Set(["d1"]))).toEqual({ dc: paths.domainController("d1") });
    });

    it("has no target for a domain controller the directory no longer lists", () => {
        expect(activityLinks(event(), new Set(["d2"]))).toEqual({});
    });

    it("has no target for an event about the domain or the server", () => {
        expect(activityLinks(event({ dcId: null }), new Set(["d1"]))).toEqual({});
    });
});
