import { describe, expect, it } from "vitest";
import { formatDate } from "../../../utils";
import { offlineNotice } from "./offlineNotice";

const LAST_SEEN = "2026-10-04T09:47:41.000Z";
const at = (date: string) => formatDate(date, { locale: "en-US" });

describe("offlineNotice", () => {
    it("says since when the agent is gone", () => {
        const notice = offlineNotice({ lastSeen: LAST_SEEN }, "en-US");
        expect(notice.title).toBe(`This domain controller's agent is offline, last seen ${at(LAST_SEEN)}`);
    });

    it("does not invent a date for an agent that never connected", () => {
        const notice = offlineNotice({ lastSeen: null }, "en-US");
        expect(notice.title).toBe("This domain controller's agent has not connected yet");
    });
});
