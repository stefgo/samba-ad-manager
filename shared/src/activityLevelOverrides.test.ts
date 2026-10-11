import { describe, expect, it } from "vitest";
import { ACTIVITY_KINDS } from "./constants.js";
import {
    ACTIVITY_DEFAULT_LEVELS,
    ACTIVITY_KINDS_ALWAYS_RECORDED,
    applyLevelOverride,
    formatLevelOverrides,
    parseLevelOverrides,
} from "./activityLevelOverrides.js";
import { AppSettingsSchema, CleanupSettingsSchema } from "./schemas.js";

describe("parseLevelOverrides", () => {
    it("reads nothing out of an empty setting", () => {
        expect(parseLevelOverrides("")).toEqual({ overrides: new Map(), error: null });
    });

    it("reads entries separated by commas or line breaks", () => {
        const { overrides, error } = parseLevelOverrides("scheduler.failed=error,\n dc.discovered = none");
        expect(error).toBeNull();
        expect([...overrides]).toEqual([
            ["scheduler.failed", "error"],
            ["dc.discovered", "none"],
        ]);
    });

    // A setting written for another version may name a kind this build does not know.
    it("takes a kind this build does not know", () => {
        expect(parseLevelOverrides("future.kind=trace").error).toBeNull();
    });

    it("names the entry it cannot read and keeps the others", () => {
        const { overrides, error } = parseLevelOverrides("scheduler.failed=loud, dc.removed=trace");
        expect(error).toBe("scheduler.failed: Must be one of trace, info, warning, error, none");
        expect([...overrides]).toEqual([["dc.removed", "trace"]]);
    });

    it("refuses an entry without a kind or a level", () => {
        expect(parseLevelOverrides("scheduler.failed").error).toBe('"scheduler.failed" is not of the form kind=level');
        expect(parseLevelOverrides("=error").error).toBe('"=error" is not of the form kind=level');
    });

    it("refuses a kind given twice", () => {
        expect(parseLevelOverrides("dc.removed=trace, dc.removed=info").error).toBe(
            "dc.removed: Given more than once",
        );
    });

    it("refuses none for a kind a group depends on, and takes a level for it", () => {
        for (const kind of ACTIVITY_KINDS_ALWAYS_RECORDED) {
            expect(parseLevelOverrides(`${kind}=none`).error).toBe(`${kind}: Cannot be set to none`);
            expect(parseLevelOverrides(`${kind}=trace`).error).toBeNull();
        }
    });
});

describe("formatLevelOverrides", () => {
    it("writes what parseLevelOverrides reads", () => {
        const text = "scheduler.failed=error, dc.discovered=none";
        expect(formatLevelOverrides(parseLevelOverrides(text).overrides)).toBe(text);
    });

    it("writes an empty setting for no override", () => {
        expect(formatLevelOverrides(new Map())).toBe("");
    });
});

describe("applyLevelOverride", () => {
    const overrides = parseLevelOverrides("scheduler.failed=error, dc.discovered=none").overrides;

    it("leaves an event alone whose kind is not overridden", () => {
        const event = { kind: "dc.removed", level: "info" as const };
        expect(applyLevelOverride(event, overrides)).toBe(event);
    });

    it("sets the configured level, whatever the event came with", () => {
        const event = { id: "a", kind: "scheduler.failed", level: "warning" as const };
        expect(applyLevelOverride(event, overrides)).toEqual({ id: "a", kind: "scheduler.failed", level: "error" });
        expect(event.level).toBe("warning");
    });

    it("drops an event whose kind is set to none", () => {
        expect(applyLevelOverride({ kind: "dc.discovered", level: "trace" as const }, overrides)).toBeNull();
    });
});

describe("ACTIVITY_DEFAULT_LEVELS", () => {
    it("names at least one level for every kind", () => {
        for (const kind of ACTIVITY_KINDS) expect(ACTIVITY_DEFAULT_LEVELS[kind].length).toBeGreaterThan(0);
    });
});

describe("the activity_level_overrides setting", () => {
    it("defaults to no override", () => {
        expect(AppSettingsSchema.parse({}).activity_level_overrides).toBe("");
    });

    it("is refused with the reason of the entry that is wrong", () => {
        const parsed = CleanupSettingsSchema.safeParse({ activity_level_overrides: "scheduler.failed=loud" });
        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues[0]).toMatchObject({
            path: ["activity_level_overrides"],
            message: "scheduler.failed: Must be one of trace, info, warning, error, none",
        });
    });

    it("is accepted as it was written", () => {
        const body = { activity_level_overrides: "scheduler.failed=error" };
        expect(CleanupSettingsSchema.parse(body)).toEqual(body);
    });
});
