import { describe, expect, it } from "vitest";
import {
    UAC,
    encodeUnicodePwd,
    escapeFilterValue,
    fileTimeToIso,
    formatGroupType,
    generalizedTimeToIso,
    guidDn,
    guidFromBytes,
    hasUacFlag,
    isoToFileTime,
    parseGroupType,
    parseUac,
    ridOfSid,
    sidFromBytes,
    withUacFlag,
} from "./adAttributes.js";

const bytes = (hex: string) => new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));

describe("userAccountControl", () => {
    it("reads the decimal string LDAP returns", () => {
        expect(parseUac("514")).toBe(514);
        expect(parseUac(null)).toBe(0);
        expect(parseUac("nonsense")).toBe(0);
    });

    it("knows a disabled account and a domain controller", () => {
        expect(hasUacFlag(514, UAC.ACCOUNT_DISABLE)).toBe(true);
        expect(hasUacFlag(512, UAC.ACCOUNT_DISABLE)).toBe(false);
        expect(hasUacFlag(532480, UAC.SERVER_TRUST_ACCOUNT)).toBe(true);
    });

    it("sets and clears one flag and leaves the others", () => {
        expect(withUacFlag(512, UAC.ACCOUNT_DISABLE, true)).toBe(514);
        expect(withUacFlag(66050, UAC.ACCOUNT_DISABLE, false)).toBe(66048);
        expect(withUacFlag(514, UAC.ACCOUNT_DISABLE, true)).toBe(514);
    });
});

describe("fileTimeToIso and isoToFileTime", () => {
    it("reads a file time", () => {
        expect(fileTimeToIso("134361371603177088")).toBe("2026-10-10T20:19:20.317Z");
    });

    it("has no date for zero, for never, and for what is no number", () => {
        expect(fileTimeToIso("0")).toBeNull();
        expect(fileTimeToIso("9223372036854775807")).toBeNull();
        expect(fileTimeToIso("")).toBeNull();
        expect(fileTimeToIso(null)).toBeNull();
        expect(fileTimeToIso("soon")).toBeNull();
    });

    it("writes what it reads", () => {
        const iso = "2027-01-01T00:00:00.000Z";
        expect(fileTimeToIso(isoToFileTime(iso))).toBe(iso);
        expect(isoToFileTime(null)).toBe("0");
    });
});

describe("generalizedTimeToIso", () => {
    it("reads the form of whenCreated", () => {
        expect(generalizedTimeToIso("20261010201709.0Z")).toBe("2026-10-10T20:17:09.000Z");
        expect(generalizedTimeToIso("20261010201709Z")).toBe("2026-10-10T20:17:09.000Z");
    });

    it("has no date for anything else", () => {
        expect(generalizedTimeToIso("2026-10-10")).toBeNull();
        expect(generalizedTimeToIso(null)).toBeNull();
    });
});

describe("guidFromBytes and guidDn", () => {
    it("writes the first three groups the other way round", () => {
        expect(guidFromBytes(bytes("3f5c59d7e681bd41920a7a3643407f79"))).toBe("d7595c3f-81e6-41bd-920a-7a3643407f79");
    });

    it("is nothing for bytes that are no GUID", () => {
        expect(guidFromBytes(bytes("0102"))).toBeNull();
    });

    it("addresses an object by its GUID, and refuses what is none", () => {
        expect(guidDn("D7595C3F-81E6-41BD-920A-7A3643407F79")).toBe("<GUID=d7595c3f-81e6-41bd-920a-7a3643407f79>");
        expect(() => guidDn("CN=x>,DC=test")).toThrow();
    });
});

describe("sidFromBytes and ridOfSid", () => {
    it("reads a domain SID", () => {
        const sid = sidFromBytes(bytes("010500000000000515000000" + "01000000" + "02000000" + "03000000" + "f4010000"));
        expect(sid).toBe("S-1-5-21-1-2-3-500");
        expect(ridOfSid(sid)).toBe(500);
    });

    it("reads a well-known SID", () => {
        expect(sidFromBytes(bytes("01020000000000052000000020020000"))).toBe("S-1-5-32-544");
    });

    it("is nothing for bytes of the wrong length", () => {
        expect(sidFromBytes(bytes("0105000000000005"))).toBeNull();
        expect(ridOfSid(null)).toBeNull();
    });
});

describe("groupType", () => {
    it("reads scope and kind out of the signed number", () => {
        expect(parseGroupType("-2147483646")).toEqual({ scope: "global", kind: "security", builtin: false });
        expect(parseGroupType("-2147483643")).toEqual({ scope: "domainLocal", kind: "security", builtin: true });
        expect(parseGroupType("8")).toEqual({ scope: "universal", kind: "distribution", builtin: false });
    });

    it("writes what it reads", () => {
        expect(formatGroupType("global", "security")).toBe("-2147483646");
        expect(formatGroupType("universal", "distribution")).toBe("8");
        expect(parseGroupType(formatGroupType("domainLocal", "security"))).toMatchObject({
            scope: "domainLocal",
            kind: "security",
        });
    });
});

describe("encodeUnicodePwd", () => {
    it("quotes the password and writes it as UTF-16LE", () => {
        expect([...encodeUnicodePwd("aß")]).toEqual([0x22, 0, 0x61, 0, 0xdf, 0, 0x22, 0]);
    });
});

describe("escapeFilterValue", () => {
    it("escapes what a filter would read as syntax", () => {
        expect(escapeFilterValue("a*(b)\\c")).toBe("a\\2a\\28b\\29\\5cc");
        expect(escapeFilterValue("plain")).toBe("plain");
    });
});
