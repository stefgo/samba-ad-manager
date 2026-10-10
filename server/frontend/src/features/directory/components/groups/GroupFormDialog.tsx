import { Alert, Button, Input, Modal, Select } from "@stefgo/react-ui-components";
import { CreateGroupSchema, GROUP_KINDS, GROUP_SCOPES, type GroupKind, type GroupScope } from "@sadm/shared";
import { useEntityForm } from "../../../../hooks/useEntityForm";
import { directoryApi, useDirectoryChange } from "../../../../queries/directory";
import {
    GROUP_KIND_LABELS,
    GROUP_SCOPE_LABELS,
    createGroupInputFrom,
    groupDraftFrom,
    groupFieldOf,
} from "../../lib/directoryForms";
import { ContainerSelect } from "../ContainerSelect";

interface GroupFormDialogProps {
    defaultParentDn: string;
    onClose: () => void;
    onCreated?: (guid: string) => void;
}

const FORM_ID = "directory-group-form";

/** Creates a group. Scope and kind are chosen here once: the directory restricts changing them later. */
export const GroupFormDialog = ({ defaultParentDn, onClose, onCreated }: GroupFormDialogProps) => {
    const create = useDirectoryChange(directoryApi.createGroup);
    const form = useEntityForm({
        initial: () => groupDraftFrom(defaultParentDn),
        schema: CreateGroupSchema,
        toInput: createGroupInputFrom,
        fieldOf: groupFieldOf,
        rules: (draft) => (draft.parentDn ? {} : { parentDn: "Choose where the group is created." }),
    });
    const { draft, set, errors } = form;

    return (
        <Modal
            isOpen
            onClose={onClose}
            title="New Group"
            size="lg"
            closeOnOverlayClick={false}
            footer={
                <>
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button type="submit" form={FORM_ID} variant="primary" disabled={!form.canSave} isLoading={form.isSaving}>
                        Create Group
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
                <Input label="Name" value={draft.name} onChange={(e) => set("name", e.target.value)} error={errors.name} autoFocus />
                <Input
                    label="Description"
                    value={draft.description}
                    onChange={(e) => set("description", e.target.value)}
                    error={errors.description}
                />
                <Input label="E-mail" type="email" value={draft.mail} onChange={(e) => set("mail", e.target.value)} error={errors.mail} />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Select
                        label="Scope"
                        value={draft.scope}
                        onChange={(e) => set("scope", e.target.value as GroupScope)}
                        options={GROUP_SCOPES.map((scope) => ({ value: scope, label: GROUP_SCOPE_LABELS[scope] }))}
                        hint="Global: members from this domain, usable anywhere in the forest."
                    />
                    <Select
                        label="Type"
                        value={draft.kind}
                        onChange={(e) => set("kind", e.target.value as GroupKind)}
                        options={GROUP_KINDS.map((kind) => ({ value: kind, label: GROUP_KIND_LABELS[kind] }))}
                        hint="Security groups grant access; distribution groups are mailing lists."
                    />
                </div>
            </form>
        </Modal>
    );
};
