import { Alert, Button, Input, Modal } from "@stefgo/react-ui-components";
import { z } from "zod";
import { useEntityForm } from "../../../hooks/useEntityForm";

/** The text fields a small edit dialog may hold. */
export interface TextField {
    key: string;
    label: string;
    type?: "text" | "email";
    max: number;
    hint?: string;
}

interface TextFieldsDialogProps {
    title: string;
    fields: TextField[];
    /** What the object holds now. */
    values: Record<string, string | null | undefined>;
    onClose: () => void;
    /** Receives only what changed; an emptied field arrives as `null` and clears the attribute. */
    onSave: (changes: Record<string, string | null>) => Promise<unknown>;
}

const FORM_ID = "directory-text-form";

/**
 * Edits a few text attributes of an object: the description of a computer or an
 * organizational unit, description and e-mail of a group. One dialog for all of them --
 * they differ in nothing but which fields there are.
 */
export const TextFieldsDialog = ({ title, fields, values, onClose, onSave }: TextFieldsDialogProps) => {
    const schema = z.object(
        Object.fromEntries(fields.map((field) => [field.key, z.string().trim().max(field.max, `At most ${field.max} characters`)])),
    );
    const form = useEntityForm({
        initial: () => Object.fromEntries(fields.map((field) => [field.key, values[field.key] ?? ""])) as Record<string, string>,
        schema,
        toInput: (draft) => draft,
        fieldOf: (path) => (typeof path[0] === "string" ? path[0] : null),
    });

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={title}
            closeOnOverlayClick={false}
            footer={
                <>
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button type="submit" form={FORM_ID} variant="primary" disabled={!form.canSave} isLoading={form.isSaving}>
                        Save
                    </Button>
                </>
            }
        >
            <form
                id={FORM_ID}
                className="space-y-4"
                onSubmit={async (event) => {
                    event.preventDefault();
                    const stored = await form.submit((input) => {
                        const changes: Record<string, string | null> = {};
                        for (const field of fields) {
                            const next = (input[field.key] ?? "").trim();
                            if (next !== (values[field.key] ?? "")) changes[field.key] = next === "" ? null : next;
                        }
                        return onSave(changes);
                    });
                    if (stored) onClose();
                }}
            >
                {form.saveError && <Alert>{form.saveError}</Alert>}
                {fields.map((field, index) => (
                    <Input
                        key={field.key}
                        label={field.label}
                        type={field.type ?? "text"}
                        value={form.draft[field.key] ?? ""}
                        onChange={(event) => form.set(field.key, event.target.value)}
                        error={form.errors[field.key]}
                        hint={field.hint}
                        autoFocus={index === 0}
                    />
                ))}
            </form>
        </Modal>
    );
};
