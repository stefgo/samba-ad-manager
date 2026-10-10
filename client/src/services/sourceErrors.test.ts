import { describe, expect, it } from "vitest";
import { sourceErrorChange } from "./sourceErrors.js";

const ldap = { source: "ldap", message: "connect ECONNREFUSED" };
const container = { source: "container", message: "no such container" };

describe("sourceErrorChange", () => {
    it("names a source the first time it cannot be read", () => {
        expect(sourceErrorChange([], [ldap])).toEqual({ failed: [ldap], recovered: [] });
    });

    it("says nothing while a source stays unreadable for the same reason", () => {
        expect(sourceErrorChange([ldap], [ldap])).toEqual({ failed: [], recovered: [] });
    });

    it("names a source again when the reason changes", () => {
        const other = { source: "ldap", message: "certificate has expired" };
        expect(sourceErrorChange([ldap], [other])).toEqual({ failed: [other], recovered: [] });
    });

    it("names a source that can be read again", () => {
        expect(sourceErrorChange([ldap, container], [container])).toEqual({ failed: [], recovered: ["ldap"] });
    });
});
