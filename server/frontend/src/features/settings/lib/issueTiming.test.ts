import { describe, expect, it } from "vitest";
import { DOMAIN_ISSUE_TYPES } from "@sadm/shared";
import { ISSUE_KINDS, minutesOf, withMinutes } from "./issueTiming";

describe("ISSUE_KINDS", () => {
    it("lists every kind of finding once, with a name", () => {
        expect(ISSUE_KINDS.map((kind) => kind.type)).toEqual([...DOMAIN_ISSUE_TYPES]);
        expect(ISSUE_KINDS.every((kind) => kind.label.length > 0)).toBe(true);
    });
});

describe("minutesOf", () => {
    it("is the minutes of a kind that has its own, and empty for one on the default", () => {
        const setting = "replication-failing=15, dc-unreachable=0";
        expect(minutesOf(setting, "replication-failing")).toBe("15");
        expect(minutesOf(setting, "dc-unreachable")).toBe("0");
        expect(minutesOf(setting, "storage-low")).toBe("");
    });
});

describe("withMinutes", () => {
    it("sets, replaces and removes the entry of one kind", () => {
        const set = withMinutes("", "replication-failing", "15");
        expect(set).toBe("replication-failing=15");
        const replaced = withMinutes(set, "replication-failing", "20");
        expect(replaced).toBe("replication-failing=20");
        expect(withMinutes(replaced, "replication-failing", "")).toBe("");
    });

    it("keeps the entries of other kinds, also one this build does not know", () => {
        expect(withMinutes("future-kind=3, storage-low=10", "dc-unreachable", "2")).toBe("future-kind=3, storage-low=10, dc-unreachable=2");
    });

    it("keeps a value the server would refuse as it was typed, and shows it so", () => {
        const setting = withMinutes("", "storage-low", "1441");
        expect(setting).toBe("storage-low=1441");
        expect(minutesOf(setting, "storage-low")).toBe("1441");
    });
});
