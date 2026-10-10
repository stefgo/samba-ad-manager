import { CreateUserSchema } from "@sadm/shared";
import { Button, Checkbox, FormField, Input, Modal, Alert } from "@stefgo/react-ui-components";
import { useEntityForm } from "../../../hooks/useEntityForm";
import {
    userDraftFrom,
    userFieldOf,
    userInputFrom,
    userRules,
    type AuthMethod,
    type StoredUser,
    type UserInput,
} from "../lib/userForm";

interface UserDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: UserInput) => Promise<void>;
    editingUser: (StoredUser & { id: number }) | null;
}

const FORM_ID = "user-dialog-form";

/**
 * Mounted only while open, and anew for each user: the form starts over by being a new
 * one, where it used to copy the props into its state while rendering.
 */
export const UserDialog = ({ isOpen, ...props }: UserDialogProps) =>
    isOpen ? <OpenUserDialog key={props.editingUser?.id ?? "new"} {...props} /> : null;

const OpenUserDialog = ({ onClose, onSave, editingUser }: Omit<UserDialogProps, "isOpen">) => {
    const form = useEntityForm({
        initial: () => userDraftFrom(editingUser),
        schema: CreateUserSchema,
        toInput: userInputFrom,
        fieldOf: userFieldOf,
        rules: (draft) => userRules(draft, editingUser),
    });
    const { draft, set, errors } = form;
    const local = draft.authMethods.includes("local");

    const toggleAuthMethod = (method: AuthMethod) =>
        set(
            "authMethods",
            draft.authMethods.includes(method)
                ? draft.authMethods.filter((m) => m !== method)
                : [...draft.authMethods, method],
        );

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (await form.submit(onSave)) onClose();
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={editingUser ? "Edit Account" : "Add Account"}
            size="lg"
            // A stray click beside the dialog must not throw away what was typed.
            closeOnOverlayClick={false}
            footer={
                <>
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button
                        type="submit"
                        form={FORM_ID}
                        variant="primary"
                        disabled={!form.canSave}
                        isLoading={form.isSaving}
                    >
                        {editingUser ? "Save" : "Add Account"}
                    </Button>
                </>
            }
        >
            <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
                {/* Only what the server answered: what the form itself objects to is at its field. */}
                {form.saveError && (
                    <Alert>{form.saveError}</Alert>
                )}

                <Input
                    label="Username"
                    type="text"
                    value={draft.username}
                    onChange={(e) => set("username", e.target.value)}
                    disabled={!!editingUser}
                    placeholder="username"
                    error={errors.username}
                />

                <FormField label="Authentication Methods" error={errors.authMethods}>
                    {({ describedBy }) => (
                        <div role="group" aria-describedby={describedBy} className="flex gap-4 mt-1">
                            <Checkbox
                                label="Local (Password)"
                                checked={local}
                                onChange={() => toggleAuthMethod("local")}
                            />
                            <Checkbox
                                label="OIDC (SSO)"
                                checked={draft.authMethods.includes("oidc")}
                                onChange={() => toggleAuthMethod("oidc")}
                            />
                        </div>
                    )}
                </FormField>

                {/* Only with local sign-in: an account that signs in through OIDC has no password. */}
                {local && (
                    <Input
                        label={editingUser ? "New Password (leave blank to keep current)" : "Password"}
                        type="password"
                        value={draft.password}
                        onChange={(e) => set("password", e.target.value)}
                        placeholder={editingUser ? "••••••••" : "password"}
                        error={errors.password}
                    />
                )}
            </form>
        </Modal>
    );
};
