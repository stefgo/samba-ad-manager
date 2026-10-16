import { describe, expect, it } from "vitest";
import { HISTORY_HEAD, HISTORY_TAIL, emptyHistory, withAppeared, withGap, withGone, withSeverity } from "./issueHistory.js";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 16, 10, minute)).toISOString();

describe("the history of a finding", () => {
    it("records what happened, in order", () => {
        let history = withAppeared(emptyHistory(), at(0), "warning", "slow");
        history = withGap(history, at(1), at(2));
        history = withSeverity(history, at(3), "error", "down");
        history = withGone(history, at(9));
        expect(history).toEqual({
            entries: [
                { change: "appeared", at: at(0), severity: "warning", text: "slow" },
                { change: "gap", first: at(1), last: at(1), count: 1, longestSeconds: 60 },
                { change: "severity", first: at(3), last: at(3), count: 1, severity: "error", text: "down" },
                { change: "gone", at: at(9) },
            ],
            omitted: 0,
        });
    });

    it("folds gaps that follow each other into one entry with a count", () => {
        let history = withAppeared(emptyHistory(), at(0), "warning", "x");
        history = withGap(history, at(1), at(2));
        history = withGap(history, at(3), at(6));
        history = withGap(history, at(7), at(8));
        expect(history.entries).toEqual([
            { change: "appeared", at: at(0), severity: "warning", text: "x" },
            { change: "gap", first: at(1), last: at(7), count: 3, longestSeconds: 180 },
        ]);
    });

    it("folds changes of severity that follow each other, keeping the latest", () => {
        let history = withAppeared(emptyHistory(), at(0), "warning", "x");
        history = withSeverity(history, at(1), "error", "x is down");
        history = withSeverity(history, at(2), "warning", "x is slow");
        expect(history.entries[1]).toEqual({ change: "severity", first: at(1), last: at(2), count: 2, severity: "warning", text: "x is slow" });
    });

    it("keeps its beginning and its end when gaps and changes take turns, and counts what it left out", () => {
        let history = withAppeared(emptyHistory(), at(0), "warning", "x");
        for (let round = 0; round < 30; round++) {
            history = withGap(history, at(2 * round + 1), at(2 * round + 2));
            history = withSeverity(history, at(2 * round + 2), round % 2 === 0 ? "error" : "warning", "x");
        }
        expect(history.entries).toHaveLength(HISTORY_HEAD + HISTORY_TAIL);
        expect(history.omitted).toBe(1 + 60 - HISTORY_HEAD - HISTORY_TAIL);
        expect(history.entries[0].change).toBe("appeared");
        expect(history.entries[history.entries.length - 1]).toMatchObject({ change: "severity", first: at(60) });
    });
});
