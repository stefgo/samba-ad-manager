import { describe, expect, it, vi } from "vitest";

// The service reads config.yaml and the data directory the moment it is imported.
vi.mock("../core/Config.js", () => ({ config: { report: { dbcheckIntervalHours: 24 }, samba: { python: "python3" } } }));
vi.mock("../core/DataStore.js", () => ({ readJsonFile: () => null, writeJsonFile: () => true }));
vi.mock("../core/Connection.js", () => ({ Connection: { onServerMessage: () => {}, onConnected: () => {}, send: () => false } }));

const { isDbcheckDue } = await import("./DbcheckService.js");

const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3600_000).toISOString();

describe("isDbcheckDue", () => {
    it("is due when none has run yet", () => {
        expect(isDbcheckDue(null, 24, NOW)).toBe(true);
    });

    it("is due once the last one is as old as the interval", () => {
        expect(isDbcheckDue(hoursAgo(23), 24, NOW)).toBe(false);
        expect(isDbcheckDue(hoursAgo(24), 24, NOW)).toBe(true);
    });

    it("is never due with the schedule switched off", () => {
        expect(isDbcheckDue(null, 0, NOW)).toBe(false);
        expect(isDbcheckDue(hoursAgo(1000), 0, NOW)).toBe(false);
    });

    it("is due when the stored time cannot be read", () => {
        expect(isDbcheckDue("yesterday", 24, NOW)).toBe(true);
    });
});
