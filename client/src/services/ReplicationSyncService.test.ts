import { describe, expect, it, vi } from "vitest";

// The service reads the data directory and talks to the server; neither is wanted here.
vi.mock("../core/DataStore.js", () => ({ readJsonFile: () => null, writeJsonFile: () => true }));
vi.mock("../core/Connection.js", () => ({ Connection: { onServerMessage: () => {}, onConnected: () => {}, send: () => false } }));
vi.mock("./SambaHelper.js", () => ({ runSambaHelper: () => Promise.reject(new Error("not in a test")) }));

const { syncEntry, syncSucceeded } = await import("./ReplicationSyncService.js");

const link = (error: string | null = null) => ({ partner: "p", namingContext: "DC=sadm,DC=test", error });

describe("syncSucceeded", () => {
    it("is a replication in which every link replicated", () => {
        expect(syncSucceeded({ links: [link(), link()] }, true)).toBe(true);
    });

    it("is not one in which a link failed, or all did", () => {
        expect(syncSucceeded({ links: [link(), link("WERR_X")] }, true)).toBe(false);
        expect(syncSucceeded({ links: [link("WERR_X")] }, true)).toBe(false);
    });

    it("is not one that could not reach the replication service", () => {
        expect(syncSucceeded({ links: [], error: "NT_STATUS_ACCESS_DENIED" }, false)).toBe(false);
    });

    it("takes no link for success only where there is no partner to have one with", () => {
        expect(syncSucceeded({ links: [] }, false)).toBe(true);
        expect(syncSucceeded({ links: [] }, true)).toBe(false);
    });
});

describe("syncEntry", () => {
    it("keeps how many links there were, how many failed, and why nothing was asked", () => {
        expect(syncEntry({ links: [link(), link("WERR_X")] })).toEqual({ links: 2, failed: 1 });
        expect(syncEntry({ links: [], error: "refused" })).toEqual({ links: 0, failed: 0, error: "refused" });
    });
});
