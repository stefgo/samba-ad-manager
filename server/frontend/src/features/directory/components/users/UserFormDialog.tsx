import { Alert, Button, Checkbox, Input, Modal } from "@stefgo/react-ui-components";
import { CreateDirectoryUserSchema, UpdateDirectoryUserSchema, type DirectoryUser } from "@sadm/shared";
import { useEntityForm } from "../../../../hooks/useEntityForm";
import { directoryApi, useDirectoryChange } from "../../../../queries/directory";
import {
    createUserInputFrom,
    updateUserInputFrom,
    userDraftFrom,
    userFieldOf,
    userRules,
    type UserDraft,
} from "../../lib/directoryForms";
import { ContainerSelect } from "../ContainerSelect";

interface UserFormDialogProps {
    /** The user to edit, or null for a new one. */
    user: DirectoryUser | null;
    /** Where a new user is created unless another container is chosen. */
    defaultParentDn: string;
    onClose: () => void;
    /** Told the GUID of a user that was created, so the page can open it. */
    onCreated?: (guid: string) => void;
}

const FORM_ID = "directory-user-form";

/** The fields both forms share, with their errors. */
const NameFields = ({
    draft,
    set,
    errors,
}: {
    draft: UserDraft;
    set: <K extends keyof UserDraft>(key: K, value: UserDraft[K]) => void;
    errors: Partial<Record<keyof UserDraft, string>>;
}) => (
    <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="First name" value={draft.givenName} onChange={(e) => set("givenName", e.target.value)} error={errors.givenName} />
            <Input label="Last name" value={draft.surname} onChange={(e) => set("surname", e.target.value)} error={errors.surname} />
        </div>
        <Input
            label="Display name"
            value={draft.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            error={errors.displayName}
            placeholder={[draft.givenName, draft.surname].filter(Boolean).join(" ") || undefined}
        />
        <Input label="E-mail" type="email" value={draft.mail} onChange={(e) => set("mail", e.target.value)} error={errors.mail} />
        <Input label="Description" value={draft.description} onChange={(e) => set("description", e.target.value)} error={errors.description} />
    </>
);

const CreateForm = ({ defaultParentDn, onClose, onCreated }: Omit<UserFormDialogProps, "user">) => {
    const create = useDirectoryChange(directoryApi.createUser);
    const form = useEntityForm({
        initial: () => userDraftFrom(null, defaultParentDn),
        schema: CreateDirectoryUserSchema,
        toInput: createUserInputFrom,
        fieldOf: userFieldOf,
        rules: (draft) => userRules(draft, true),
    });
    const { draft, set, errors } = form;

    return (
        <Modal
            isOpen
            onClose={onClose}
            title="New User"
            size="lg"
            closeOnOverlayClick={false}
            footer={
                <>
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button type="submit" form={FORM_ID} variant="primary" disabled={!form.canSave} isLoading={form.isSaving}>
                        Create User
                    </Button>
                </>
            }
        >
            <form
                id={FORM_ID}
                className="space-y-4"
                onSubmit={async (event) => {
                    event.preventDefault();
                    let guid: string | undefined;
                    const stored = await form.submit(async (input) => {
                        guid = (await create.mutateAsync(input)).guid;
                    });
                    if (stored) {
                        onClose();
                        if (guid) onCreated?.(guid);
                    }
                }}
            >
                {form.saveError && <Alert>{form.saveError}</Alert>}
                <ContainerSelect label="Create in" value={draft.parentDn} onChange={(dn) => set("parentDn", dn)} error={errors.parentDn} />
                <Input
                    label="Logon name"
                    value={draft.accountName}
                    onChange={(e) => set("accountName", e.target.value)}
                    error={errors.accountName}
                    hint="The name the user logs on with (sAMAccountName), at most 20 characters."
                    autoFocus
                />
                <NameFields draft={draft} set={set} errors={errors} />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                        label="Password"
                        type="password"
                        autoComplete="new-password"
                        value={draft.password}
                        onChange={(e) => set("password", e.target.value)}
                        error={errors.password}
                    />
                    <Input
                        label="Repeat password"
                        type="password"
                        autoComplete="new-password"
                        value={draft.passwordRepeat}
                        onChange={(e) => set("passwordRepeat", e.target.value)}
                        error={errors.passwordRepeat}
                    />
                </div>
                <div className="space-y-2">
                    <Checkbox
                        label="User must change the password at next logon"
                        checked={draft.mustChangePassword}
                        onChange={(e) => set("mustChangePassword", e.target.checked)}
                    />
                    <Checkbox
                        label="Password never expires"
                        checked={draft.passwordNeverExpires}
                        onChange={(e) => set("passwordNeverExpires", e.target.checked)}
                        error={errors.passwordNeverExpires}
                    />
                    <Checkbox label="Account is enabled" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} />
                </div>
            </form>
        </Modal>
    );
};

const EditForm = ({ user, onClose }: { user: DirectoryUser; onClose: () => void }) => {
    const update = useDirectoryChange((changes: Parameters<typeof directoryApi.updateUser>[1]) =>
        directoryApi.updateUser(user.guid, changes),
    );
    const form = useEntityForm({
        initial: () => userDraftFrom(user, user.parentDn),
        schema: UpdateDirectoryUserSchema,
        toInput: (draft) => updateUserInputFrom(draft, user),
        fieldOf: userFieldOf,
        rules: (draft) => userRules(draft, false),
    });
    const { draft, set, errors } = form;

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={`Edit ${user.accountName}`}
            size="lg"
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
                    if (await form.submit((input) => update.mutateAsync(input))) onClose();
                }}
            >
                {form.saveError && <Alert>{form.saveError}</Alert>}
                <NameFields draft={draft} set={set} errors={errors} />
                <Input
                    label="User principal name"
                    value={draft.userPrincipalName}
                    onChange={(e) => set("userPrincipalName", e.target.value)}
                    error={errors.userPrincipalName}
                    hint="The logon name in the form name@domain."
                />
                <Checkbox
                    label="Password never expires"
                    checked={draft.passwordNeverExpires}
                    onChange={(e) => set("passwordNeverExpires", e.target.checked)}
                    error={errors.passwordNeverExpires}
                />
            </form>
        </Modal>
    );
};

/** Creates a user or edits one. Mounted only while open, and anew for each user. */
export const UserFormDialog = ({ user, ...rest }: UserFormDialogProps) =>
    user ? <EditForm key={user.guid} user={user} onClose={rest.onClose} /> : <CreateForm {...rest} />;
