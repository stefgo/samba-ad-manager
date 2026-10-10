import type { z } from "zod";

/**
 * The rules a form is checked by, apart from React: what `useEntityForm` computes on every
 * render. They live here because the tests run without a DOM -- a rule inside the hook
 * would be a rule nothing checks.
 */

/** One message per field of the draft. A field that is fine has no key. */
export type FieldErrors<D> = Partial<Record<keyof D & string, string>>;

/** Which field of the draft an issue belongs to; `null` when it belongs to none. */
export type FieldOf<D> = (path: readonly PropertyKey[]) => (keyof D & string) | null;

/**
 * Thrown by a `toInput` that cannot build the request -- a header line without a colon is
 * gone by the time a schema could object to it. Names the field, so the message lands
 * there like any other.
 */
export class DraftFieldError<D> extends Error {
    constructor(
        readonly field: keyof D & string,
        message: string,
    ) {
        super(message);
        this.name = "DraftFieldError";
    }
}

/**
 * Whether two drafts hold the same values. Structural, and over plain data only -- which
 * is all a draft consists of. Key order does not count, unlike with `JSON.stringify`, and
 * neither does a key that is `undefined` on one side and missing on the other.
 */
export function isSameDraft(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((item, index) => isSameDraft(item, b[index]));
    }
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
        if (!isSameDraft(left[key], right[key])) return false;
    }
    return true;
}

/**
 * The default {@link FieldOf}: a draft field is named like the request's, so the first
 * segment of the path is the field. Anything else is an issue no field can show.
 */
export function sameNamedField<D extends object>(draft: D): FieldOf<D> {
    return (path) => {
        const head = path[0];
        return typeof head === "string" && head in draft ? (head as keyof D & string) : null;
    };
}

interface Issue {
    readonly path: readonly PropertyKey[];
    readonly message: string;
    readonly code?: string;
    /** `invalid_key` only: what the key's own schema objected to. */
    readonly issues?: readonly { readonly message: string }[];
}

/**
 * What an issue says. A record refuses a key with "Invalid key in record" and keeps the
 * reason one level down -- the message the key's schema was given, which is the one worth
 * reading.
 */
function messageOf(issue: Issue): string {
    return (issue.code === "invalid_key" && issue.issues?.[0]?.message) || issue.message;
}

/**
 * The schema's issues, by field. The first issue of a field wins: it is the one the
 * schema checks first, and a field shows one message. Issues without a field come back
 * as `unplaced`, so they are reported somewhere rather than only keeping the button off.
 */
export function fieldErrorsFrom<D>(
    issues: readonly Issue[],
    fieldOf: FieldOf<D>,
): { errors: FieldErrors<D>; unplaced: string[] } {
    const errors: FieldErrors<D> = {};
    const unplaced: string[] = [];
    for (const issue of issues) {
        const field = fieldOf(issue.path);
        if (field === null) {
            const path = issue.path.join(".");
            unplaced.push(path ? `${path}: ${messageOf(issue)}` : messageOf(issue));
        } else if (errors[field] === undefined) {
            errors[field] = messageOf(issue);
        }
    }
    return { errors, unplaced };
}

export interface DraftRules<D extends object, S extends z.ZodType> {
    /** The schema the backend parses the request with. */
    schema: S;
    /** The draft as the request carries it. May throw {@link DraftFieldError}. */
    toInput: (draft: D) => z.input<S>;
    /** Where an issue of the schema is shown. Defaults to {@link sameNamedField}. */
    fieldOf?: FieldOf<D>;
    /**
     * What only the form knows: a secret that is required when creating and optional when
     * editing, a schedule that needs a start. Wins over the schema's message for the same
     * field -- it is the more specific one.
     */
    rules?: (draft: D) => FieldErrors<D>;
}

export interface DraftCheck<D, I> {
    /** What to send. `null` when the draft cannot be turned into a request at all. */
    input: I | null;
    errors: FieldErrors<D>;
    /** What is wrong and belongs to no field. */
    formError: string | null;
    isValid: boolean;
}

/** Checks a draft the way saving it would be checked, without sending anything. */
export function checkDraft<D extends object, S extends z.ZodType>(
    { schema, toInput, fieldOf, rules }: DraftRules<D, S>,
    draft: D,
): DraftCheck<D, z.input<S>> {
    const errors: FieldErrors<D> = { ...rules?.(draft) };
    let input: z.input<S> | null = null;
    let formError: string | null = null;

    try {
        input = toInput(draft);
    } catch (e) {
        if (e instanceof DraftFieldError) {
            const field = e.field as keyof D & string;
            errors[field] ??= e.message;
        } else {
            formError = e instanceof Error ? e.message : String(e);
        }
    }

    if (input !== null) {
        const parsed = schema.safeParse(input);
        if (!parsed.success) {
            const fromSchema = fieldErrorsFrom(parsed.error.issues, fieldOf ?? sameNamedField(draft));
            for (const [field, message] of Object.entries(fromSchema.errors) as [keyof D & string, string][]) {
                errors[field] ??= message;
            }
            formError = fromSchema.unplaced[0] ?? null;
        }
    }

    return { input, errors, formError, isValid: formError === null && Object.keys(errors).length === 0 };
}
