import { describe, expect, it } from "vitest";
import { afterAttempt, startSeries, waitBeforeResuming } from "./series.js";

const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";

describe("startSeries", () => {
    it("takes the id, the attempts and the wait from the request", () => {
        expect(startSeries({ correlationId: ID, retries: 2, retryDelayMinutes: 10 })).toEqual({
            id: ID,
            attempt: 1,
            of: 3,
            delayMs: 600_000,
            nextAttemptAt: null,
            history: [],
        });
    });

    it("is one attempt for a request from a server that names none", () => {
        expect(startSeries({})).toMatchObject({ id: null, of: 1 });
    });
});

describe("afterAttempt", () => {
    const series = startSeries({ correlationId: ID, retries: 2, retryDelayMinutes: 10 });

    it("tries again after the wait while attempts are left", () => {
        const step = afterAttempt(series, false, { failed: 1 }, NOW);
        const next = new Date(NOW + 600_000).toISOString();
        expect(step.state).toEqual({ id: ID, attempt: 1, of: 3, nextAttemptAt: next, done: false, history: [{ failed: 1 }] });
        expect(step.series).toMatchObject({ attempt: 2, nextAttemptAt: next, history: [{ failed: 1 }] });
    });

    it("is over once an attempt succeeds", () => {
        const step = afterAttempt(series, true, { failed: 0 }, NOW);
        expect(step.state).toMatchObject({ attempt: 1, done: true, nextAttemptAt: null });
        expect(step.series).toBeNull();
    });

    it("is over after the last attempt, whatever it left, with every attempt in its history", () => {
        let step = afterAttempt(series, false, { n: 1 }, NOW);
        step = afterAttempt(step.series!, false, { n: 2 }, NOW);
        step = afterAttempt(step.series!, false, { n: 3 }, NOW);
        expect(step.state).toMatchObject({ attempt: 3, of: 3, done: true, nextAttemptAt: null });
        expect(step.state.history).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
        expect(step.series).toBeNull();
    });
});

describe("waitBeforeResuming", () => {
    it("waits out what is left of the wait, and runs an interrupted attempt at once", () => {
        const waiting = { ...startSeries({}), nextAttemptAt: new Date(NOW + 90_000).toISOString() };
        expect(waitBeforeResuming(waiting, NOW)).toBe(90_000);
        expect(waitBeforeResuming(waiting, NOW + 120_000)).toBe(0);
        expect(waitBeforeResuming(startSeries({}), NOW)).toBe(0);
    });
});
