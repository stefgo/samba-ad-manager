import { describe, expect, it } from "vitest";
import { attemptsSuffix, seriesText } from "./series";
import { formatDate, formatTime } from "../../../utils";

const locale = "en-GB";
const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const series = { id: "x", attempt: 1, of: 3, done: false, history: [] };

describe("seriesText", () => {
    it("says nothing of an operation that is over, or of a report without one", () => {
        expect(seriesText({ ...series, done: true }, NOW, locale)).toBeNull();
        expect(seriesText(null, NOW, locale)).toBeNull();
    });

    it("names the attempt that waits, and when it runs", () => {
        const next = new Date(NOW + 10 * 60_000).toISOString();
        expect(seriesText({ ...series, nextAttemptAt: next }, NOW, locale)).toBe(
            `Attempt 1 of 3 left something to do; attempt 2 at ${formatTime(next, locale)}`,
        );
        const tomorrow = new Date(NOW + 24 * 3600_000).toISOString();
        expect(seriesText({ ...series, nextAttemptAt: tomorrow }, NOW, locale)).toContain(formatDate(tomorrow, { locale }));
    });

    it("names the attempt that runs", () => {
        expect(seriesText({ ...series, attempt: 2 }, NOW, locale)).toBe("Attempt 2 of 3");
    });
});

describe("attemptsSuffix", () => {
    it("counts the attempts of an operation that took more than one", () => {
        expect(attemptsSuffix({ ...series, attempt: 3, done: true })).toBe(" (3 attempts)");
        expect(attemptsSuffix({ ...series, attempt: 1, done: true })).toBe("");
        expect(attemptsSuffix(null)).toBe("");
    });
});
