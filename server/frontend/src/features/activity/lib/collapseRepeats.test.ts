import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "@sadm/shared";
import { LISTED_REPEATS, collapseRepeats, describeRepeats, rowEvents } from "./collapseRepeats";
import { type ActivityGroup, groupActivity } from "./groupActivity";
import { formatDate, formatTime } from "../../../utils";

let clock = 0;

/** Events are created oldest first and a minute apart. */
const event = (id: string, kind: string, over: Partial<ActivityRecord> = {}): ActivityRecord => {
    clock += 1;
    const at = new Date(Date.UTC(2026, 0, 1, 0, clock, 0)).toISOString();
    return {
        id,
        kind,
        occurredAt: at,
        dcId: null,
        level: "info",
        seen: false,
        ...over,
    };
};

const failed = (id: string, over: Partial<ActivityRecord> = {}) =>
    event(id, "scheduler.failed", { level: "error", data: { scheduler: "health", error: "timeout" }, ...over });

const rowsOf = (...events: ActivityRecord[]) => collapseRepeats(groupActivity([...events].reverse()));

describe("collapseRepeats", () => {
    it("folds the same message about the same thing into the newest row", () => {
        const rows = rowsOf(failed("a"), failed("b"), failed("c"));
        expect(rows).toHaveLength(1);
        expect(rows[0].head.id).toBe("c");
        expect(rows[0].repeats.map((g) => g.head.id)).toEqual(["b", "a"]);
    });

    it("leaves a row without a repeat as it is", () => {
        const [row] = rowsOf(failed("a"));
        expect(row.repeats).toEqual([]);
    });

    it("does not fold across a row that says something else", () => {
        const rows = rowsOf(failed("a"), event("x", "dc.discovered"), failed("b"));
        expect(rows.map((r) => r.head.id)).toEqual(["b", "x", "a"]);
    });

    it.each([
        ["another domain controller", { dcId: "d2" }],
        ["another object", { subject: { name: "DC2" } }],
        ["another error", { data: { scheduler: "health", error: "refused" } }],
        ["another level", { level: "warning" as const }],
        ["one that has been seen", { seen: true }],
    ])("keeps %s apart", (_, over) => {
        expect(rowsOf(failed("a"), failed("b", over))).toHaveLength(2);
    });

    it("never folds a correlated group with steps", () => {
        const finding = (id: string) => [
            event(`${id}o`, "domain.issue_opened", { correlationId: id, level: "warning", data: { text: "DC1: x" } }),
            event(`${id}r`, "domain.issue_resolved", { correlationId: id, data: { text: "DC1: x" } }),
        ];
        expect(rowsOf(...finding("a"), ...finding("b"))).toHaveLength(2);
    });
});

describe("rowEvents", () => {
    it("names every event of the row and of its repeats", () => {
        const [row] = rowsOf(failed("a"), failed("b"));
        expect(rowEvents(row).map((e) => e.id)).toEqual(["b", "a"]);
    });

    it("names the superseded events of a row as well", () => {
        const requested = event("q", "agent.dbcheck_fix_requested", { correlationId: "f1" });
        const late = event("l", "agent.dbcheck_fix_unconfirmed", { correlationId: "f1", level: "warning" });
        const fixed = event("f", "agent.dbcheck_fixed", { correlationId: "f1" });
        const [row] = rowsOf(requested, late, fixed);
        expect(rowEvents(row).map((e) => e.id).sort()).toEqual(["f", "l", "q"]);
    });
});

describe("describeRepeats", () => {
    const locale = "en-GB";
    // Midday UTC, so a span of a few hours stays on one day in any time zone the tests run in.
    const noon = Date.UTC(2026, 9, 14, 12, 0, 0);
    /** `count` repeats `gapMs` apart, the newest `gapMs` before noon, newest first. */
    const repeats = (count: number, gapMs: number) =>
        Array.from({ length: count }, (_, i) => {
            const at = new Date(noon - (i + 1) * gapMs);
            return groupActivity([failed(`r${i}`, { occurredAt: at.toISOString() })])[0];
        });
    const date = (at: Date) => formatDate(at, { seconds: true, locale });
    const at = (group: ActivityGroup) => new Date(group.head.occurredAt);

    it("names a few repeats one by one, each with its date", () => {
        const few = repeats(LISTED_REPEATS, 61_000);
        expect(describeRepeats(few, locale)).toBe(`Also ${few.map((g) => date(at(g))).join(" · ")}`);
    });

    it("sums up a loop: the latest few, how many more, since when, how often", () => {
        const loop = repeats(421, 61_000);
        const latest = loop.slice(0, 3).map((g) => formatTime(at(g), locale));
        expect(describeRepeats(loop, locale)).toBe(
            `Also ${latest.join(" · ")} and 418 more back to ${date(at(loop[420]))}, about every 61 s`,
        );
    });

    it("keeps the dates of the latest when the repeats span several days", () => {
        const everyOtherDay = repeats(LISTED_REPEATS + 1, 48 * 3600_000);
        const text = describeRepeats(everyOtherDay, locale);
        expect(text).toContain(`Also ${date(at(everyOtherDay[0]))} · `);
        expect(text).toMatch(/about every 2 d$/);
    });

    it("orders by time, whatever order the list is sorted in", () => {
        const loop = repeats(LISTED_REPEATS + 1, 120_000);
        expect(describeRepeats([...loop].reverse(), locale)).toBe(describeRepeats(loop, locale));
        expect(describeRepeats(loop, locale)).toMatch(/about every 2 min$/);
    });
});
