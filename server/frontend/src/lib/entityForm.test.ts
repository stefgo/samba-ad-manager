import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DraftFieldError, checkDraft, fieldErrorsFrom, isSameDraft, sameNamedField } from "./entityForm";

describe("isSameDraft", () => {
    it("compares nested values, not identities", () => {
        expect(isSameDraft({ a: [{ b: 1 }], c: "x" }, { a: [{ b: 1 }], c: "x" })).toBe(true);
        expect(isSameDraft({ a: [{ b: 1 }] }, { a: [{ b: 2 }] })).toBe(false);
    });

    it("ignores the order of keys", () => {
        expect(isSameDraft({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    });

    it("keeps the order of a list", () => {
        expect(isSameDraft(["mon", "tue"], ["tue", "mon"])).toBe(false);
    });

    it("tells a shorter list from a longer one", () => {
        expect(isSameDraft([1], [1, undefined])).toBe(false);
    });

    it("takes an undefined key for a missing one", () => {
        expect(isSameDraft({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    });

    it("tells null from an empty object and from an empty string", () => {
        expect(isSameDraft(null, {})).toBe(false);
        expect(isSameDraft({ a: null }, { a: "" })).toBe(false);
    });

    it("tells a list from an object with the same entries", () => {
        expect(isSameDraft([], {})).toBe(false);
    });
});

interface Draft {
    name: string;
    timeoutSeconds: string;
    headers: string;
}

describe("fieldErrorsFrom", () => {
    const fieldOf = sameNamedField<Draft>({ name: "", timeoutSeconds: "", headers: "" });

    it("keeps the first issue of a field", () => {
        const { errors } = fieldErrorsFrom(
            [
                { path: ["name"], message: "first" },
                { path: ["name"], message: "second" },
            ],
            fieldOf,
        );
        expect(errors).toEqual({ name: "first" });
    });

    it("places an issue inside a field on the field", () => {
        const { errors } = fieldErrorsFrom([{ path: ["headers", "X Y"], message: "Not a valid header name" }], fieldOf);
        expect(errors).toEqual({ headers: "Not a valid header name" });
    });

    it("reads the reason a record refuses a key from the key's own issue", () => {
        const { errors } = fieldErrorsFrom(
            [
                {
                    path: ["headers", "X Y"],
                    code: "invalid_key",
                    message: "Invalid key in record",
                    issues: [{ message: "Not a valid header name" }],
                },
            ],
            fieldOf,
        );
        expect(errors).toEqual({ headers: "Not a valid header name" });
    });

    it("returns an issue no field shows, with its path", () => {
        const result = fieldErrorsFrom([{ path: ["timeoutMs"], message: "Too big" }], fieldOf);
        expect(result).toEqual({ errors: {}, unplaced: ["timeoutMs: Too big"] });
    });

    it("returns an issue on the whole value without a path", () => {
        expect(fieldErrorsFrom([{ path: [], message: "Invalid input" }], fieldOf).unplaced).toEqual(["Invalid input"]);
    });
});

describe("checkDraft", () => {
    const schema = z.object({
        name: z.string().min(1, "A name is required"),
        timeoutMs: z.number().max(60000, "At most 60 seconds"),
        headers: z.record(z.string(), z.string()),
    });

    const toInput = (draft: Draft) => {
        const headers: Record<string, string> = {};
        for (const line of draft.headers.split("\n").filter(Boolean)) {
            const colon = line.indexOf(":");
            if (colon <= 0) throw new DraftFieldError<Draft>("headers", "Not \"Name: value\"");
            headers[line.slice(0, colon)] = line.slice(colon + 1).trim();
        }
        return { name: draft.name, timeoutMs: Number(draft.timeoutSeconds) * 1000, headers };
    };

    const fieldOf = (path: readonly PropertyKey[]) =>
        path[0] === "timeoutMs" ? "timeoutSeconds" : sameNamedField<Draft>(valid)(path);

    const valid: Draft = { name: "Ops", timeoutSeconds: "10", headers: "X-Token: abc" };

    it("returns the request for a draft that is fine", () => {
        expect(checkDraft({ schema, toInput, fieldOf }, valid)).toEqual({
            input: { name: "Ops", timeoutMs: 10000, headers: { "X-Token": "abc" } },
            errors: {},
            formError: null,
            isValid: true,
        });
    });

    it("shows a schema issue on the draft field the value was typed into", () => {
        const check = checkDraft({ schema, toInput, fieldOf }, { ...valid, timeoutSeconds: "90" });
        expect(check.errors).toEqual({ timeoutSeconds: "At most 60 seconds" });
        expect(check.isValid).toBe(false);
    });

    it("still returns the request when the schema refuses it", () => {
        const check = checkDraft({ schema, toInput, fieldOf }, { ...valid, name: "" });
        expect(check.input).not.toBeNull();
    });

    it("turns a field error thrown while building the request into that field's message", () => {
        const check = checkDraft({ schema, toInput, fieldOf }, { ...valid, headers: "no colon" });
        expect(check).toEqual({
            input: null,
            errors: { headers: "Not \"Name: value\"" },
            formError: null,
            isValid: false,
        });
    });

    it("reports any other error thrown while building the request for the form", () => {
        const check = checkDraft(
            {
                schema,
                toInput: () => {
                    throw new Error("boom");
                },
            },
            valid,
        );
        expect(check).toEqual({ input: null, errors: {}, formError: "boom", isValid: false });
    });

    it("prefers the form's own rule over the schema's message for the same field", () => {
        const check = checkDraft(
            { schema, toInput, fieldOf, rules: (draft) => (draft.name ? {} : { name: "Name the webhook" }) },
            { ...valid, name: "" },
        );
        expect(check.errors).toEqual({ name: "Name the webhook" });
    });

    it("refuses a draft the schema accepts when a rule does not", () => {
        const check = checkDraft({ schema, toInput, fieldOf, rules: () => ({ headers: "One header is required" }) }, valid);
        expect(check.isValid).toBe(false);
        expect(check.input).not.toBeNull();
    });

    it("reports a schema issue that has no field for the form", () => {
        const check = checkDraft({ schema, toInput }, { ...valid, timeoutSeconds: "90" });
        expect(check).toMatchObject({ errors: {}, formError: "timeoutMs: At most 60 seconds", isValid: false });
    });
});
