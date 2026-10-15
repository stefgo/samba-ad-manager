import { describe, expect, it } from "vitest";
import type { ReplicationSyncReport, SeriesState } from "@sadm/shared";
import { fixEvent, openSeriesId, seriesSettings, syncEvent } from "./agentSeries.js";

const ID = "11111111-1111-4111-8111-111111111111";
const fixedAt = "2026-10-15T12:00:00.000Z";
const series = (over: Partial<SeriesState>): SeriesState => ({ id: ID, attempt: 1, of: 3, done: false, history: [], ...over });

describe("seriesSettings", () => {
    it("reads the settings of each operation, with its own defaults", () => {
        expect(seriesSettings({}, "dbcheck-fix")).toEqual({ retries: 2, retryDelayMinutes: 10, timeoutMs: 360 * 60_000 });
        expect(seriesSettings({}, "replication-sync")).toEqual({ retries: 2, retryDelayMinutes: 2, timeoutMs: 30 * 60_000 });
        expect(
            seriesSettings({ replication_sync_retries: "0", replication_sync_retry_delay_minutes: 5, replication_sync_timeout_minutes: "10" }, "replication-sync"),
        ).toEqual({ retries: 0, retryDelayMinutes: 5, timeoutMs: 10 * 60_000 });
    });

    it("ignores what is no whole number", () => {
        expect(seriesSettings({ dbcheck_fix_retries: "often", dbcheck_fix_retry_delay_minutes: "0" }, "dbcheck-fix")).toMatchObject({
            retries: 2,
            retryDelayMinutes: 10,
        });
    });
});

describe("fixEvent", () => {
    it("is nothing for a check that followed no fix", () => {
        expect(fixEvent({ errors: 3 })).toBeNull();
    });

    it("is a trace step for an attempt that is tried again", () => {
        const next = "2026-10-15T12:10:00.000Z";
        expect(fixEvent({ errors: 1, fix: { fixedAt, errorsFound: 3 }, series: series({ nextAttemptAt: next }) })).toEqual({
            kind: "agent.dbcheck_fix_attempted",
            level: "trace",
            data: { errorsFound: 3, errorsRemaining: 1, attempt: 1, of: 3, nextAttemptAt: next },
            done: false,
        });
    });

    it.each([
        ["info when none is left", 0, 3, undefined, "info"],
        ["a warning when some are left", 1, 3, undefined, "warning"],
        ["a warning when the check after it could not be run", null, 3, undefined, "warning"],
        ["an error when the fix failed", 3, null, "locked", "error"],
    ] as const)("is %s", (_, errors, errorsFound, error, level) => {
        const history = [{ errorsFound: 3, errorsRemaining: 2 }, { errorsFound, errorsRemaining: errors }];
        const event = fixEvent({ errors, fix: { fixedAt, errorsFound, error }, series: series({ attempt: 2, done: true, history }) });
        expect(event).toMatchObject({ kind: "agent.dbcheck_fixed", level, done: true, data: { attempts: 2, history } });
    });

    it("is the outcome of one attempt for an agent that predates the series", () => {
        expect(fixEvent({ errors: 0, fix: { fixedAt, errorsFound: 3 } })).toEqual({
            kind: "agent.dbcheck_fixed",
            level: "info",
            data: { errorsFound: 3, errorsRemaining: 0, attempts: 1, history: [{ errorsFound: 3, errorsRemaining: 0 }] },
            done: true,
        });
    });
});

describe("syncEvent", () => {
    const nameOf = () => "DC2";
    const report = (over: Partial<ReplicationSyncReport>): ReplicationSyncReport => ({ syncedAt: fixedAt, links: [], ...over });
    const link = (error: string | null = null) => ({ partner: "p", namingContext: "DC=sadm,DC=test", error });

    it("is a trace step for an attempt that is tried again", () => {
        const event = syncEvent(report({ links: [link("WERR_X")], series: series({}) }), nameOf, true);
        expect(event).toMatchObject({ kind: "agent.replication_sync_attempted", level: "trace", done: false, data: { attempt: 1, of: 3, failed: 1 } });
    });

    it("is the outcome with every attempt, at the level of the last", () => {
        const history = [{ links: 2, failed: 2 }, { links: 2, failed: 1 }];
        const event = syncEvent(report({ links: [link(), link("WERR_X")], series: series({ attempt: 2, done: true, history }) }), nameOf, true);
        expect(event).toMatchObject({ kind: "agent.replication_synced", level: "warning", done: true, data: { attempts: 2, history } });
    });

    it("is info for no link where there is no partner, and a warning where there should be", () => {
        expect(syncEvent(report({}), nameOf, false).level).toBe("info");
        expect(syncEvent(report({}), nameOf, true).level).toBe("warning");
    });
});

describe("openSeriesId", () => {
    const NOW = Date.parse("2026-10-15T12:30:00.000Z");
    const receivedAt = "2026-10-15T12:20:00.000Z";

    it("is the id of an operation the last report says goes on", () => {
        expect(openSeriesId({ series: series({}), receivedAt }, 30 * 60_000, NOW)).toBe(ID);
    });

    it("is none for an outcome, a report without a series, or one older than the wait for an outcome", () => {
        expect(openSeriesId({ series: series({ done: true }), receivedAt }, 30 * 60_000, NOW)).toBeNull();
        expect(openSeriesId({ receivedAt }, 30 * 60_000, NOW)).toBeNull();
        expect(openSeriesId({ series: series({}), receivedAt }, 5 * 60_000, NOW)).toBeNull();
        expect(openSeriesId(null, 30 * 60_000, NOW)).toBeNull();
    });
});
