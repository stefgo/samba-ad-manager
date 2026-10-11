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
        const health = section("health");
        expect(Object.keys(sectionBody(health, DEFAULT_SETTINGS)).sort()).toEqual([...health.keys].sort());
    });
});

describe("sectionError", () => {
    it("has nothing to say about the defaults", () => {
        for (const s of SECTIONS) expect(sectionError(s, DEFAULT_SETTINGS)).toBeNull();
    });

    it("names the key and the server's reason for a value it would refuse", () => {
        const draft = { ...DEFAULT_SETTINGS, health_max_dbcheck_age_hours: "soon" };
        expect(sectionError(section("health"), draft)).toBe("health_max_dbcheck_age_hours: Must be a whole number");
    });

    it("does not report another section's value", () => {
        const draft = { ...DEFAULT_SETTINGS, health_max_dbcheck_age_hours: "soon" };
        expect(sectionError(section("activity"), draft)).toBeNull();
    });
});

describe("isDirty", () => {
    it("is false for a draft that equals what the server holds", () => {
        for (const s of SECTIONS) expect(isDirty(s, { ...DEFAULT_SETTINGS }, DEFAULT_SETTINGS)).toBe(false);
    });

    it("is per section", () => {
        const draft = { ...DEFAULT_SETTINGS, health_max_dbcheck_age_hours: "7" };
        expect(isDirty(section("health"), draft, DEFAULT_SETTINGS)).toBe(true);
        expect(isDirty(section("activity"), draft, DEFAULT_SETTINGS)).toBe(false);
    });

    it("ignores a key no section edits", () => {
        const draft = { ...DEFAULT_SETTINGS, something_else: "1" };
        for (const s of SECTIONS) expect(isDirty(s, draft, DEFAULT_SETTINGS)).toBe(false);
    });

    it("takes a key that is missing for an empty value", () => {
        const { health_max_dbcheck_age_hours: _dropped, ...saved } = DEFAULT_SETTINGS;
        const health = section("health");
        expect(isDirty(health, { ...saved, health_max_dbcheck_age_hours: "" }, saved)).toBe(false);
        expect(isDirty(health, DEFAULT_SETTINGS, saved)).toBe(true);
    });
});
