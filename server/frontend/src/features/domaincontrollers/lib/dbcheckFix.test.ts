import { describe, expect, it } from "vitest";
import { dbcheckFixOffer, lastFixText } from "./dbcheckFix";

const ALLOWED = { capabilities: ["dbcheck", "dbcheck-fix"], connected: true };

describe("dbcheckFixOffer", () => {
    it("is offered for a check that counted errors, by an agent that may and is there", () => {
        expect(dbcheckFixOffer(ALLOWED, { errors: 2 }, false)).toEqual({ offered: true, disabledReason: null });
        // Not known yet whether the server is read-only: it says so itself.
        expect(dbcheckFixOffer(ALLOWED, { errors: 2 }, null)).toEqual({ offered: true, disabledReason: null });
    });

    it("is not offered where there is nothing to fix, or nothing may be changed", () => {
        expect(dbcheckFixOffer(ALLOWED, null, false)).toEqual({ offered: false });
        expect(dbcheckFixOffer(ALLOWED, { errors: 0 }, false)).toEqual({ offered: false });
        expect(dbcheckFixOffer(ALLOWED, { errors: null }, false)).toEqual({ offered: false });
        expect(dbcheckFixOffer(ALLOWED, { errors: 2 }, true)).toEqual({ offered: false });
    });

    it("says why not where the agent stands in the way", () => {
        expect(dbcheckFixOffer({ ...ALLOWED, capabilities: ["dbcheck"] }, { errors: 2 }, false)).toMatchObject({
            offered: true,
            disabledReason: expect.stringContaining("report.dbcheckAllowFix"),
        });
        expect(dbcheckFixOffer({ ...ALLOWED, connected: false }, { errors: 2 }, false)).toEqual({
            offered: true,
            disabledReason: "The agent is not connected",
        });
    });
});

describe("lastFixText", () => {
    const fixedAt = "2026-10-11T00:05:00Z";

    it("says how many errors the fix went at", () => {
        expect(lastFixText({ fixedAt, errorsFound: 3 })).toBe("Went at 3 errors");
        expect(lastFixText({ fixedAt, errorsFound: 1 })).toBe("Went at 1 error");
        expect(lastFixText({ fixedAt, errorsFound: 0 })).toBe("Found nothing to fix");
    });

    it("says that a failed fix changed nothing, and why it failed", () => {
        expect(lastFixText({ fixedAt, errorsFound: null, error: "locked" })).toBe("Failed, nothing was changed: locked");
        expect(lastFixText({ fixedAt, errorsFound: null })).toBe("Failed, nothing was changed");
    });
});
