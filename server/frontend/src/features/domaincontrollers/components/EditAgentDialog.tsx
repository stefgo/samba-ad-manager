import { Alert, Button, Input, Modal } from "@stefgo/react-ui-components";
import { UpdateAgentSchema, type DcAgent, type DomainController } from "@sadm/shared";
import { useEntityForm } from "../../../hooks/useEntityForm";
import { agentAddressDraftFrom, agentAddressFieldOf, agentAddressInputFrom } from "../lib/agentForm";

interface EditAgentDialogProps {
    dc: DomainController;
    agent: DcAgent;
    onClose: () => void;
    /** Must reject on failure -- the dialog shows the reason and stays open. */
    onSave: (input: ReturnType<typeof agentAddressInputFrom>) => Promise<unknown>;
}

const FORM_ID = "edit-agent-form";

/**
 * Sets where the server dials an agent: for one whose port was moved, or that is reached at
 * another address than before. It is the one thing about an agent that is the operator's to
 * say, and only where the server is the side that dials. The agent stays registered.
 */
export const EditAgentDialog = ({ dc, agent, onClose, onSave }: EditAgentDialogProps) => {
    const form = useEntityForm({
        schema: UpdateAgentSchema,
        initial: () => agentAddressDraftFrom(agent),
        toInput: agentAddressInputFrom,
        fieldOf: agentAddressFieldOf,
    });

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={`Agent of ${dc.name}`}
            description="This server dials the agent at the new address at once. The agent stays registered."
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
                    label="Agent Address"
                    value={form.draft.targetAddress}
                    onChange={(event) => form.set("targetAddress", event.target.value)}
                    error={form.errors.targetAddress}
                    hint="Host and port the agent listens on. Write wss://host:port for an agent that serves TLS."
                    autoFocus
                />
            </form>
        </Modal>
    );
};
