import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOMAIN_ISSUE_LABELS, DOMAIN_ISSUE_TYPES } from "./domainHealth.js";
import { formatIssueTimingOverrides, issueTimingFromSettings, parseIssueTimingOverrides } from "./issueTiming.js";

describe("parseIssueTimingOverrides", () => {
    it("reads entries separated by commas and line breaks", () => {
        const { overrides, error } = parseIssueTimingOverrides("replication-failing=15,\n dc-unreachable = 2");
        expect(error).toBeNull();
        expect([...overrides]).toEqual([
            ["replication-failing", 15],
            ["dc-unreachable", 2],
        ]);
    });

    it("is empty for an empty setting", () => {
        expect(parseIssueTimingOverrides("  ")).toEqual({ overrides: new Map(), error: null });
    });

    it("keeps a kind it does not know: the setting may be from another version", () => {
        expect(parseIssueTimingOverrides("some-future-kind=3").overrides.get("some-future-kind")).toBe(3);
    });

    it.each([
        ["replication-failing", "is not of the form"],
        ["=3", "is not of the form"],
        ["replication-failing=soon", "Must be a whole number"],
        ["replication-failing=-1", "Must be a whole number"],
        ["replication-failing=1441", "Must be a whole number"],
        ["replication-failing=3, replication-failing=4", "Given more than once"],
    ])("refuses %s", (text, reason) => {
        expect(parseIssueTimingOverrides(text).error).toContain(reason);
    });

    it("returns the entries it could read next to the first it could not", () => {
        const { overrides, error } = parseIssueTimingOverrides("dc-unreachable=2, nonsense, storage-low=x");
        expect([...overrides]).toEqual([["dc-unreachable", 2]]);
        expect(error).toContain("nonsense");
    });

    it("writes back what it read", () => {
        const text = "replication-failing=15, dc-unreachable=0";
        expect(formatIssueTimingOverrides(parseIssueTimingOverrides(text).overrides)).toBe(text);
    });
});

describe("issueTimingFromSettings", () => {
    it("falls back to five minutes each", () => {
        const timing = issueTimingFromSettings({});
        expect(timing.reportAfterMs("dc-unreachable")).toBe(5 * 60_000);
        expect(timing.resolveAfterMs).toBe(5 * 60_000);
    });

    it("takes the default of the settings, and a kind's own where it has one", () => {
        const timing = issueTimingFromSettings({
            issue_report_after_minutes: "10",
            issue_resolve_after_minutes: 0,
            issue_report_after_overrides: "dc-unreachable=2",
        });
        expect(timing.reportAfterMs("dc-unreachable")).toBe(2 * 60_000);
        expect(timing.reportAfterMs("storage-low")).toBe(10 * 60_000);
        expect(timing.resolveAfterMs).toBe(0);
    });

    it("ignores what is no number", () => {
        expect(issueTimingFromSettings({ issue_report_after_minutes: "soon" }).reportAfterMs("x")).toBe(5 * 60_000);
    });
});

describe("DOMAIN_ISSUE_LABELS", () => {
    it("names every kind as the table of findings in docs/health.md does, in its order", () => {
        const doc = readFileSync(new URL("../../docs/health.md", import.meta.url), "utf-8");
        const table = doc.slice(doc.indexOf("| Finding | Severity |"));
        const names = [...table.matchAll(/^\| ([^|]+?) \|/gm)].map((m) => m[1]).filter((name) => name !== "Finding" && !name.startsWith("---"));
        expect(names.slice(0, DOMAIN_ISSUE_TYPES.length)).toEqual(DOMAIN_ISSUE_TYPES.map((type) => DOMAIN_ISSUE_LABELS[type]));
    });
});
