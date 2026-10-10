import { describe, expect, it } from "vitest";
import { isSearchHotkey } from "./searchHotkey";

const page = { tagName: "BODY" };

describe("isSearchHotkey", () => {
    it("takes a bare slash pressed on the page", () => {
        expect(isSearchHotkey({ key: "/" }, page)).toBe(true);
        expect(isSearchHotkey({ key: "/" }, { tagName: "button" })).toBe(true);
        expect(isSearchHotkey({ key: "/" }, null)).toBe(true);
    });

    it("leaves the slash to a field it is typed into", () => {
        for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
            expect(isSearchHotkey({ key: "/" }, { tagName })).toBe(false);
        }
        expect(isSearchHotkey({ key: "/" }, { tagName: "DIV", isContentEditable: true })).toBe(false);
    });

    it("leaves a slash with a modifier to whoever owns that shortcut", () => {
        expect(isSearchHotkey({ key: "/", ctrlKey: true }, page)).toBe(false);
        expect(isSearchHotkey({ key: "/", metaKey: true }, page)).toBe(false);
        expect(isSearchHotkey({ key: "/", altKey: true }, page)).toBe(false);
    });

    it("ignores every other key", () => {
        expect(isSearchHotkey({ key: "s" }, page)).toBe(false);
        expect(isSearchHotkey({ key: "?" }, page)).toBe(false);
    });
});
