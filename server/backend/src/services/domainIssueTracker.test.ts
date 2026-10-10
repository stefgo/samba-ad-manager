import { describe, expect, it } from "vitest";
import type { DomainIssue } from "@sadm/shared";
import { EMPTY_TRACKER_STATE, trackIssues, type OpenIssue } from "./domainIssueTracker.js";

const CONFIRM = 45_000;
const T0 = 1_000_000;

const issue = (id: string, text = `${id} is wrong`): DomainIssue => ({ id, type: "port-closed", severity: "error", dc: "DC1", text });

const announced = (id: string, text = `${id} is wrong`): OpenIssue => ({
    id,
    type: "port-closed",
    severity: "error",
    dc: "DC1",
    clientId: "a",
    text,
    openedAt: new Date(T0).toISOString(),
    correlationId: `c-${id}`,
});

describe("trackIssues", () => {
    it("waits before it announces a finding", () => {
        const first = trackIssues(EMPTY_TRACKER_STATE, [], [issue("x")], T0, CONFIRM);
        expect(first.opened).toEqual([]);
        expect(first.state.appearing.get("x")).toBe(T0);

        const early = trackIssues(first.state, [], [issue("x")], T0 + CONFIRM - 1, CONFIRM);
        expect(early.opened).toEqual([]);

        const due = trackIssues(early.state, [], [issue("x")], T0 + CONFIRM, CONFIRM);
        expect(due.opened.map((i) => i.id)).toEqual(["x"]);
        expect(due.state.appearing.size).toBe(0);
    });

    it("forgets a finding that went before it was announced", () => {
        const first = trackIssues(EMPTY_TRACKER_STATE, [], [issue("x")], T0, CONFIRM);
        const gone = trackIssues(first.state, [], [], T0 + 10_000, CONFIRM);
        expect(gone.state.appearing.size).toBe(0);
        // Back later, the wait starts over.
        const back = trackIssues(gone.state, [], [issue("x")], T0 + 50_000, CONFIRM);
        expect(back.opened).toEqual([]);
        expect(back.state.appearing.get("x")).toBe(T0 + 50_000);
    });

    it("announces at once with no wait", () => {
        expect(trackIssues(EMPTY_TRACKER_STATE, [], [issue("x")], T0, 0).opened).toHaveLength(1);
    });

    it("waits before it calls an announced finding off", () => {
        const missed = trackIssues(EMPTY_TRACKER_STATE, [announced("x")], [], T0, CONFIRM);
        expect(missed.resolved).toEqual([]);
        expect(missed.state.vanishing.get("x")).toBe(T0);

        const due = trackIssues(missed.state, [announced("x")], [], T0 + CONFIRM, CONFIRM);
        expect(due.resolved.map((i) => i.id)).toEqual(["x"]);
    });

    it("keeps a finding that came back before it was called off", () => {
        const missed = trackIssues(EMPTY_TRACKER_STATE, [announced("x")], [], T0, CONFIRM);
        const back = trackIssues(missed.state, [announced("x")], [issue("x")], T0 + 10_000, CONFIRM);
        expect(back.resolved).toEqual([]);
        expect(back.opened).toEqual([]);
        expect(back.state.vanishing.size).toBe(0);
    });

    it("does not announce what is announced already, and notes new words for it", () => {
        const step = trackIssues(EMPTY_TRACKER_STATE, [announced("x", "failed 1 time")], [issue("x", "failed 2 times")], T0, CONFIRM);
        expect(step.opened).toEqual([]);
        expect(step.reworded).toEqual([{ id: "x", text: "failed 2 times" }]);
    });

    it("handles findings independently", () => {
        const first = trackIssues(EMPTY_TRACKER_STATE, [announced("old")], [issue("new")], T0, CONFIRM);
        const second = trackIssues(first.state, [announced("old")], [issue("new")], T0 + CONFIRM, CONFIRM);
        expect(second.opened.map((i) => i.id)).toEqual(["new"]);
        expect(second.resolved.map((i) => i.id)).toEqual(["old"]);
    });
});
