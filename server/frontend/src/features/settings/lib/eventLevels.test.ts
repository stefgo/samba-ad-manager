import { describe, expect, it } from "vitest";
import { ACTIVITY_KINDS, ACTIVITY_KINDS_ALWAYS_RECORDED, type ActivityKind } from "@sadm/shared";
import { DEFAULT_CHOICE, EVENT_LEVEL_GROUPS, choiceOf, levelChoices, withChoice } from "./eventLevels";

describe("EVENT_LEVEL_GROUPS", () => {
    it("holds every kind once", () => {
        const kinds = EVENT_LEVEL_GROUPS.flatMap((group) => group.kinds);
        expect([...kinds].sort()).toEqual([...ACTIVITY_KINDS].sort());
    });

    it("has a heading for every kind this build knows", () => {
        expect(EVENT_LEVEL_GROUPS.map((group) => group.label)).not.toContain("Other");
    });

    it("keeps the kinds of one prefix together, wherever they stand in the list", () => {
        const controllers = EVENT_LEVEL_GROUPS.find((group) => group.label === "Domain controllers");
        expect(controllers?.kinds).toContain("dc.discovered");
        expect(controllers?.kinds).toContain("dc.removed");
    });
});

describe("levelChoices", () => {
    it("names the level a kind has when left alone", () => {
        expect(levelChoices("scheduler.failed")[0]).toEqual({
            value: DEFAULT_CHOICE,
            label: "Default (error)",
        });
    });

    it("offers none for a kind that can be switched off", () => {
        expect(levelChoices("dc.discovered").map((c) => c.value)).toEqual([
            DEFAULT_CHOICE, "trace", "info", "warning", "error", "none",
        ]);
    });

    it("does not offer none for a kind a group depends on", () => {
        for (const kind of ACTIVITY_KINDS_ALWAYS_RECORDED) {
            expect(levelChoices(kind as ActivityKind).map((c) => c.value)).not.toContain("none");
        }
    });
});

describe("choiceOf", () => {
    it("is the default for a kind the setting does not name", () => {
        expect(choiceOf("scheduler.failed=error", "dc.removed")).toBe(DEFAULT_CHOICE);
    });

    it("is what the setting says", () => {
        expect(choiceOf("scheduler.failed=error, dc.discovered=none", "dc.discovered")).toBe("none");
    });
});

describe("withChoice", () => {
    it("adds an entry", () => {
        expect(withChoice("", "scheduler.failed", "error")).toBe("scheduler.failed=error");
    });

    it("replaces an entry", () => {
        expect(withChoice("scheduler.failed=error, dc.removed=trace", "scheduler.failed", "info")).toBe(
            "dc.removed=trace, scheduler.failed=info",
        );
    });

    it("removes the entry of a kind set back to its default", () => {
        expect(withChoice("scheduler.failed=error, dc.removed=trace", "scheduler.failed", DEFAULT_CHOICE)).toBe(
            "dc.removed=trace",
        );
    });

    // Written into config.yaml by hand, for a kind this build does not know.
    it("keeps an entry this page has no row for", () => {
        expect(withChoice("future.kind=none", "scheduler.failed", "error")).toBe(
            "future.kind=none, scheduler.failed=error",
        );
    });

    it("does not write what the server would refuse", () => {
        for (const kind of ACTIVITY_KINDS_ALWAYS_RECORDED) {
            expect(withChoice("", kind, "none")).toBe("");
        }
    });
});
