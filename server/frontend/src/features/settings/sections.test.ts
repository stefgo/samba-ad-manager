import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SECTIONS, SECTION_IDS, isDirty, sectionBody, sectionError } from "./sections";

const section = (id: string) => SECTIONS.find((s) => s.id === id)!;

describe("SECTIONS", () => {
    it("lists every section once", () => {
        expect(SECTION_IDS).toEqual(SECTIONS.map((s) => s.id));
        expect(new Set(SECTION_IDS).size).toBe(SECTION_IDS.length);
    });

    // A key in two sections would let one section's Save write over the other's edit.
    it("gives every key to exactly one section", () => {
        const keys = SECTIONS.flatMap((s) => s.keys);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("has a default for every key a section edits, and no default without a section", () => {
        expect(SECTIONS.flatMap((s) => s.keys).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    });
});

describe("sectionBody", () => {
    it("holds the section's own keys and no others", () => {
        const tokens = section("tokens");
        expect(Object.keys(sectionBody(tokens, DEFAULT_SETTINGS)).sort()).toEqual([...tokens.keys].sort());
    });
});

describe("sectionError", () => {
    it("has nothing to say about the defaults", () => {
        for (const s of SECTIONS) expect(sectionError(s, DEFAULT_SETTINGS)).toBeNull();
    });

    it("names the key and the server's reason for a value it would refuse", () => {
        const draft = { ...DEFAULT_SETTINGS, token_retention_days: "soon" };
        expect(sectionError(section("tokens"), draft)).toBe("token_retention_days: Must be a whole number");
    });

    it("does not report another section's value", () => {
        const draft = { ...DEFAULT_SETTINGS, token_retention_days: "soon" };
        expect(sectionError(section("activity"), draft)).toBeNull();
    });
});

describe("isDirty", () => {
    it("is false for a draft that equals what the server holds", () => {
        for (const s of SECTIONS) expect(isDirty(s, { ...DEFAULT_SETTINGS }, DEFAULT_SETTINGS)).toBe(false);
    });

    it("is per section", () => {
        const draft = { ...DEFAULT_SETTINGS, token_retention_days: "7" };
        expect(isDirty(section("tokens"), draft, DEFAULT_SETTINGS)).toBe(true);
        expect(isDirty(section("activity"), draft, DEFAULT_SETTINGS)).toBe(false);
    });

    it("ignores a key no section edits", () => {
        const draft = { ...DEFAULT_SETTINGS, something_else: "1" };
        for (const s of SECTIONS) expect(isDirty(s, draft, DEFAULT_SETTINGS)).toBe(false);
    });

    it("takes a key that is missing for an empty value", () => {
        const { token_retention_days: _dropped, ...saved } = DEFAULT_SETTINGS;
        const tokens = section("tokens");
        expect(isDirty(tokens, { ...saved, token_retention_days: "" }, saved)).toBe(false);
        expect(isDirty(tokens, DEFAULT_SETTINGS, saved)).toBe(true);
    });
});
