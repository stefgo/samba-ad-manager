import { describe, expect, it } from "vitest";
import { describeDeleteObject } from "./confirmations";

describe("describeDeleteObject", () => {
    it("says nothing about subobjects where there are none", () => {
        expect(describeDeleteObject({ name: "PLUTO$", type: "computer", subobjectCount: 0 }).description).toBe(
            "The machine can no longer log on to the domain and has to be joined again. This cannot be undone from here.",
        );
        expect(describeDeleteObject({ name: "Sales", type: "group" }).description).not.toContain("below it");
    });

    it("names how many objects go along with a computer", () => {
        expect(describeDeleteObject({ name: "PLUTO$", type: "computer", subobjectCount: 3 }).description).toContain(
            "The 3 objects below it are deleted with it, such as BitLocker recovery keys or published printers.",
        );
    });

    it("names a single object in the singular, and a user's in a user's terms", () => {
        expect(describeDeleteObject({ name: "jdoe", type: "user", subobjectCount: 1 }).description).toContain(
            "The 1 object below it is deleted with it, such as what an application keeps with the account.",
        );
    });
});
