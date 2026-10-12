import { describe, expect, it } from "vitest";
import { gpoGuidOfFolder, gptIniVersion } from "./gptIni.js";

describe("gptIniVersion", () => {
    it("reads the version Samba writes", () => {
        expect(gptIniVersion("[General]\nVersion=65539\n")).toBe(65539);
    });

    it("reads a file Windows wrote: CRLF, a byte order mark, another case", () => {
        expect(gptIniVersion("\uFEFF[general]\r\nversion = 3\r\ndisplayName=New Group Policy Object\r\n")).toBe(3);
    });

    it("looks in the General section only", () => {
        expect(gptIniVersion("[Other]\nVersion=7\n")).toBeNull();
        expect(gptIniVersion("[Other]\nVersion=7\n[General]\nVersion=2\n")).toBe(2);
    });

    it("has no version for a file without one, or with one that is no number", () => {
        expect(gptIniVersion("")).toBeNull();
        expect(gptIniVersion("[General]\n; Version=4\n")).toBeNull();
        expect(gptIniVersion("[General]\nVersion=four\n")).toBeNull();
    });
});

describe("gpoGuidOfFolder", () => {
    it("takes the GUID out of a policy's folder name", () => {
        expect(gpoGuidOfFolder("{31B2F340-016D-11D2-945F-00C04FB984F9}")).toBe("31b2f340-016d-11d2-945f-00c04fb984f9");
    });

    it("is null for anything else in the Policies folder", () => {
        expect(gpoGuidOfFolder("PolicyDefinitions")).toBeNull();
        expect(gpoGuidOfFolder("31B2F340-016D-11D2-945F-00C04FB984F9")).toBeNull();
    });
});
