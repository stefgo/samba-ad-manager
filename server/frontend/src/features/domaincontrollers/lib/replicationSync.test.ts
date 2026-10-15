import { describe, expect, it } from "vitest";
import { replicationSyncOffer } from "./replicationSync";

const ABLE = { capabilities: ["local", "dbcheck", "replication-sync"], connected: true };

describe("replicationSyncOffer", () => {
    it("is offered by an agent that can and is there", () => {
        expect(replicationSyncOffer(ABLE, 2)).toEqual({ offered: true, disabledReason: null });
    });

    it("is not offered without an agent", () => {
        expect(replicationSyncOffer(null, 2)).toEqual({ offered: false });
    });

    it("says why not where the agent stands in the way", () => {
        expect(replicationSyncOffer({ ...ABLE, capabilities: ["local", "dbcheck"] }, 2).offered).toBe(true);
        expect(replicationSyncOffer({ ...ABLE, capabilities: ["local", "dbcheck"] }, 2)).toMatchObject({ disabledReason: expect.stringContaining("too old") });
        expect(replicationSyncOffer({ ...ABLE, connected: false }, 2)).toEqual({ offered: true, disabledReason: "The agent is not connected" });
    });

    it("says why not for the only domain controller there is", () => {
        expect(replicationSyncOffer(ABLE, 1)).toEqual({ offered: true, disabledReason: "This domain controller has no partner to replicate from" });
    });
});
