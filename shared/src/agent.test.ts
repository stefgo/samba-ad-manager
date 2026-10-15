import { describe, expect, it } from "vitest";
import { DbcheckReportSchema, DcLocalReportSchema } from "./agent.js";

describe("DbcheckReportSchema", () => {
    const REPORT = { checkedAt: "2026-10-11T12:00:00Z", errors: 0, durationMs: 4200 };

    it("takes a check that counted, and one that could not be run", () => {
        expect(DbcheckReportSchema.safeParse(REPORT).success).toBe(true);
        expect(DbcheckReportSchema.safeParse({ ...REPORT, errors: null, error: "sam.ldb cannot be opened" }).success).toBe(true);
    });

    it("keeps a field a newer agent adds", () => {
        expect(DbcheckReportSchema.parse({ ...REPORT, fixed: 2 })).toMatchObject({ fixed: 2 });
    });

    it("takes the fix a check followed, one that worked and one that did not", () => {
        const fixedAt = "2026-10-11T11:58:00Z";
        expect(DbcheckReportSchema.safeParse({ ...REPORT, fix: { fixedAt, errorsFound: 3, durationMs: 1200 } }).success).toBe(true);
        expect(DbcheckReportSchema.safeParse({ ...REPORT, fix: { fixedAt, errorsFound: null, error: "the transaction failed" } }).success).toBe(true);
    });

    it("refuses a fix without a time", () => {
        expect(DbcheckReportSchema.safeParse({ ...REPORT, fix: { errorsFound: 3 } }).success).toBe(false);
    });

    it("refuses a report without a time", () => {
        expect(DbcheckReportSchema.safeParse({ errors: 0 }).success).toBe(false);
    });
});

describe("DcLocalReportSchema", () => {
    it("takes a report with nothing but its time: every part may be missing", () => {
        expect(DcLocalReportSchema.parse({ collectedAt: "2026-10-11T12:00:00Z" })).toEqual({
            collectedAt: "2026-10-11T12:00:00Z",
            errors: [],
        });
    });

    it("takes a process in a state this build has never heard of", () => {
        const processes = [{ name: "samba", state: "SOMETHING_NEW", pid: 12 }];
        expect(DcLocalReportSchema.safeParse({ collectedAt: "2026-10-11T12:00:00Z", processes }).success).toBe(true);
    });
});
