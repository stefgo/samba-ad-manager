import { describe, expect, it } from "vitest";
import { hasAddClientInput, type AddClientInput } from "./addClientForm";

const input = (changes: Partial<AddClientInput> = {}): AddClientInput => ({
    displayName: "",
    restrictIp: false,
    allowedIp: "",
    hostname: "",
    targetAddress: "",
    registrationSecret: "",
    ...changes,
});

describe("hasAddClientInput", () => {
    it("is false for the flow as it opens", () => {
        expect(hasAddClientInput(input())).toBe(false);
    });

    it("does not count whitespace", () => {
        expect(hasAddClientInput(input({ displayName: "  ", targetAddress: " " }))).toBe(false);
    });

    it("counts every field of either branch", () => {
        for (const key of ["displayName", "allowedIp", "hostname", "targetAddress", "registrationSecret"] as const) {
            expect(hasAddClientInput(input({ [key]: "x" }))).toBe(true);
        }
    });

    it("counts the ticked restriction", () => {
        expect(hasAddClientInput(input({ restrictIp: true }))).toBe(true);
    });
});
