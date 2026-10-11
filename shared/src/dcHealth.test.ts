import { describe, expect, it } from "vitest";
import { DbcheckReportSchema, dbcheckScope } from "./dcHealth.js";

const REPORT = {
    dcId: "11111111-1111-4111-8111-111111111111",
    checkedAt: "2026-10-11T12:00:00Z",
    errors: 0,
    durationMs: 4200,
};

describe("DbcheckReportSchema", () => {
    it("takes the report of the current script, which says what it checked", () => {
        const parsed = DbcheckReportSchema.parse({ ...REPORT, scope: "all" });
        expect(dbcheckScope(parsed)).toBe("all");
    });

    it("takes the report of a script from before that, and reads it as the domain alone", () => {
        const parsed = DbcheckReportSchema.parse(REPORT);
        expect(parsed.scope).toBeUndefined();
        expect(dbcheckScope(parsed)).toBe("domain");
    });

    it("refuses a scope it does not know", () => {
        expect(DbcheckReportSchema.safeParse({ ...REPORT, scope: "some" }).success).toBe(false);
    });
});
