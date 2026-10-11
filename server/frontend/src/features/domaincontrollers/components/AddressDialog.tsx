import { Alert, Button, Input, Modal } from "@stefgo/react-ui-components";
import { UpdateDomainControllerSchema, type DomainController, type UpdateDomainController } from "@sadm/shared";
import { useEntityForm } from "../../../hooks/useEntityForm";
import { addressDraftFrom, addressFieldOf, addressInputFrom } from "../lib/domainControllerForm";

interface AddressDialogProps {
    dc: DomainController;
    onClose: () => void;
    /** Must reject on failure -- the dialog shows the reason and stays open. */
    onSave: (input: UpdateDomainController) => Promise<unknown>;
}

const FORM_ID = "domain-controller-address-form";

/**
 * Sets where the server reaches a domain controller. Which domain controllers there are and
 * what they are called is the directory's to say; this is for the one thing it cannot know
 * -- that its name for one does not resolve from where this server stands.
 */
export const AddressDialog = ({ dc, onClose, onSave }: AddressDialogProps) => {
    const form = useEntityForm({
        schema: UpdateDomainControllerSchema,
        initial: () => addressDraftFrom(dc),
        toInput: addressInputFrom,
        fieldOf: addressFieldOf,
    });

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={`Address of ${dc.name}`}
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
                    if (await form.submit(onSave)) onClose();
                }}
            >
                {form.saveError && <Alert>{form.saveError}</Alert>}
                <Input
                    label="Address"
                    value={form.draft.address}
                    onChange={(event) => form.set("address", event.target.value)}
                    error={form.errors.address}
                    placeholder={dc.dnsHostName ?? undefined}
                    hint={`A host name or an IP address. Leave empty to reach it by its name in the directory${dc.dnsHostName ? `, ${dc.dnsHostName}` : ""}. Its certificate is still checked against that name.`}
                    autoFocus
                />
            </form>
        </Modal>
    );
};
