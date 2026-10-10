import { useState } from "react";
import type { z } from "zod";
import { checkDraft, isSameDraft, type DraftRules, type FieldErrors } from "../lib/entityForm";
import { getErrorMessage } from "../utils";

interface EntityFormOptions<D extends object, S extends z.ZodType> extends DraftRules<D, S> {
    /** The draft the form opens with. Read once; `reset` is how a form starts over. */
    initial: D | (() => D);
    /**
     * The part of a draft that counts as a change, when that is not all of it: an address
     * typed under a box that was unticked again is sent nowhere, and asking about it on
     * the way out would be asking about nothing. Defaults to the whole draft.
     */
    significant?: (draft: D) => unknown;
}

interface SubmitOptions<D> {
    /**
     * What the form holds once the save went through, when that is not what was typed: a
     * secret field that goes back to "unchanged", a key that is now the stored one.
     */
    rebase?: (draft: D) => D;
}

export interface EntityForm<D extends object, I> {
    draft: D;
    set: <K extends keyof D>(key: K, value: D[K]) => void;
    patch: (changes: Partial<D>) => void;
    /** Starts over with another draft: the new baseline, nothing saved, nothing failed. */
    reset: (next: D) => void;
    /**
     * What to show at the fields. Empty while nothing was changed: a form that was just
     * opened has a disabled button because there is nothing to save, not because a field
     * is wrong, and marking every empty field of a new entity would say otherwise.
     */
    errors: FieldErrors<D>;
    /** What is wrong and belongs to no field, for the footer. */
    formError: string | null;
    isValid: boolean;
    isDirty: boolean;
    /** Changed, valid and not being saved. */
    canSave: boolean;
    isSaving: boolean;
    /** Why the last save failed. Gone with the next change: it described another draft. */
    saveError: string | null;
    /** True while what is on screen is what was last stored. */
    saved: boolean;
    /**
     * Sends the draft through `save` and makes it the baseline. Resolves `true` when it
     * was stored; a refusal is in `saveError` and resolves `false`.
     */
    submit: (save: (input: I) => Promise<unknown>, options?: SubmitOptions<D>) => Promise<boolean>;
}

/**
 * The state every editor keeps: a draft, what it was when it was opened or last saved,
 * and how the save went. The draft is checked against the schema the backend parses the
 * request with, so what the server would refuse is said at the field before it is sent.
 *
 * What is not in here is a form's UI state -- an open file browser, a half-typed list
 * entry. It is not part of what is saved, so it does not make the form dirty, and it
 * stays in the component that shows it.
 */
export function useEntityForm<D extends object, S extends z.ZodType>({
    initial,
    significant,
    ...rules
}: EntityFormOptions<D, S>): EntityForm<D, z.input<S>> {
    const [baseline, setBaseline] = useState<D>(initial);
    const [draft, setDraft] = useState<D>(baseline);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [justSaved, setJustSaved] = useState(false);

    const check = checkDraft(rules, draft);
    const isDirty = significant
        ? !isSameDraft(significant(draft), significant(baseline))
        : !isSameDraft(draft, baseline);
    const canSave = isDirty && check.isValid && !isSaving;

    const patch = (changes: Partial<D>) => {
        setDraft((prev) => ({ ...prev, ...changes }));
        setSaveError(null);
    };

    const set = <K extends keyof D>(key: K, value: D[K]) => patch({ [key]: value } as unknown as Partial<D>);

    const reset = (next: D) => {
        setBaseline(next);
        setDraft(next);
        setSaveError(null);
        setJustSaved(false);
    };

    const submit: EntityForm<D, z.input<S>>["submit"] = async (save, options) => {
        // The button asks `canSave` too, but a form is also submitted by Enter.
        if (!canSave || check.input === null) return false;
        const sent = draft;
        setIsSaving(true);
        setSaveError(null);
        setJustSaved(false);
        try {
            await save(check.input);
            const stored = options?.rebase ? options.rebase(sent) : sent;
            setBaseline(stored);
            // Only when nothing was typed meanwhile: what was typed since is not stored.
            setDraft((current) => (current === sent ? stored : current));
            setJustSaved(true);
            return true;
        } catch (e) {
            console.error(e);
            setSaveError(getErrorMessage(e));
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    return {
        draft,
        set,
        patch,
        reset,
        errors: isDirty ? check.errors : {},
        formError: isDirty ? check.formError : null,
        isValid: check.isValid,
        isDirty,
        canSave,
        isSaving,
        saveError,
        saved: justSaved && !isDirty,
        submit,
    };
}
