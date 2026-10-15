import { describe, expect, it, vi } from "vitest";

// The service reads config.yaml and the data directory the moment it is imported.
vi.mock("../core/Config.js", () => ({ config: { report: { dbcheckIntervalHours: 24 }, samba: { python: "python3" } } }));
vi.mock("../core/DataStore.js", () => ({ readJsonFile: () => null, writeJsonFile: () => true }));
vi.mock("../core/Connection.js", () => ({ Connection: { onServerMessage: () => {}, onConnected: () => {}, send: () => false } }));

const { fixEntry, fixSucceeded, isDbcheckDue, planDbcheckJob } = await import("./DbcheckService.js");

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

describe("planDbcheckJob", () => {
    it("starts what is asked for when nothing runs", () => {
        expect(planDbcheckJob(null, "check")).toBe("start");
        expect(planDbcheckJob(null, "fix")).toBe("start");
    });

    it("joins a running fix, which ends with a check", () => {
        expect(planDbcheckJob("fix", "check")).toBe("join");
        expect(planDbcheckJob("fix", "fix")).toBe("join");
    });

    it("joins a running check with a check, and has a fix wait for it", () => {
        expect(planDbcheckJob("check", "check")).toBe("join");
        expect(planDbcheckJob("check", "fix")).toBe("after");
    });
});

describe("fixSucceeded", () => {
    const fixedAt = "2026-10-12T12:00:00.000Z";

    it("is a fix that ran and left no error", () => {
        expect(fixSucceeded({ errors: 0, fix: { fixedAt, errorsFound: 3 } })).toBe(true);
        expect(fixSucceeded({ errors: 0, fix: { fixedAt, errorsFound: 0 } })).toBe(true);
    });

    it.each([
        ["a fix that failed", { errors: 3, fix: { fixedAt, errorsFound: null, error: "locked" } }],
        ["a fix that left errors", { errors: 1, fix: { fixedAt, errorsFound: 3 } }],
        ["a fix whose check could not be run", { errors: null, fix: { fixedAt, errorsFound: 3 } }],
    ])("is not %s", (_, report) => {
        expect(fixSucceeded(report)).toBe(false);
    });
});

describe("fixEntry", () => {
    it("keeps what the fix went at, what was left, and why it failed", () => {
        const fixedAt = "2026-10-12T12:00:00.000Z";
        expect(fixEntry({ errors: 1, fix: { fixedAt, errorsFound: 3 } })).toEqual({ errorsFound: 3, errorsRemaining: 1 });
        expect(fixEntry({ errors: 3, fix: { fixedAt, errorsFound: null, error: "locked" } })).toEqual({
            errorsFound: null,
            errorsRemaining: 3,
            error: "locked",
        });
    });
});
