import { describe, expect, it } from "vitest";
import { replicationSyncOffer } from "./replicationSync";

const ABLE = { capabilities: ["local", "dbcheck", "replication-sync"], connected: true };

describe("replicationSyncOffer", () => {
    it("is offered by an agent that can and is there", () => {
        expect(replicationSyncOffer(ABLE)).toEqual({ offered: true, disabledReason: null });
    });

    it("is not offered without an agent", () => {
        expect(replicationSyncOffer(null)).toEqual({ offered: false });
    });

    it("says why not where the agent stands in the way", () => {
        expect(replicationSyncOffer({ ...ABLE, capabilities: ["local", "dbcheck"] }).offered).toBe(true);
        expect(replicationSyncOffer({ ...ABLE, capabilities: ["local", "dbcheck"] })).toMatchObject({ disabledReason: expect.stringContaining("too old") });
        expect(replicationSyncOffer({ ...ABLE, connected: false })).toEqual({ offered: true, disabledReason: "The agent is not connected" });
    });
});
