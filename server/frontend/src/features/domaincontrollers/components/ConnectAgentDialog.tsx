import { Alert, Button, Input, Modal } from "@stefgo/react-ui-components";
import { ConnectAgentSchema, type DomainController } from "@sadm/shared";
import { useEntityForm } from "../../../hooks/useEntityForm";
import { connectAgentDraftFrom, connectAgentFieldOf, connectAgentInputFrom } from "../lib/agentForm";

interface ConnectAgentDialogProps {
    dc: DomainController;
    onClose: () => void;
    /** Must reject on failure -- the dialog shows the agent's reason and stays open. */
    onConnect: (input: ReturnType<typeof connectAgentInputFrom>) => Promise<unknown>;
}

const FORM_ID = "connect-agent-form";

/**
 * Has the server dial an agent that waits on a port of its own: for a domain controller
 * that cannot reach this server, or whose container was started without a token. The agent
 * prints a setup PIN into its log, and whoever can read that log may register it.
 */
export const ConnectAgentDialog = ({ dc, onClose, onConnect }: ConnectAgentDialogProps) => {
    const form = useEntityForm({
        schema: ConnectAgentSchema,
        initial: () => connectAgentDraftFrom(dc),
        toInput: connectAgentInputFrom,
        fieldOf: connectAgentFieldOf,
        // The address is filled in already; what makes the form worth sending is the PIN.
        significant: (draft) => ({ registrationSecret: draft.registrationSecret }),
    });

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={`Connect to the agent of ${dc.name}`}
            description="This server dials the agent, registers it with its setup PIN and stays connected."
            closeOnOverlayClick={false}
            footer={
                <>
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button type="submit" form={FORM_ID} variant="primary" disabled={!form.canSave} isLoading={form.isSaving}>
                        Connect
                    </Button>
                </>
            }
        >
            <form
                id={FORM_ID}
                className="space-y-4"
                onSubmit={async (event) => {
                    event.preventDefault();
                    if (await form.submit(onConnect)) onClose();
                }}
            >
                {form.saveError && <Alert>{form.saveError}</Alert>}
                <Input
                    label="Agent Address"
                    value={form.draft.targetAddress}
                    onChange={(event) => form.set("targetAddress", event.target.value)}
                    error={form.errors.targetAddress}
                    hint="Host and port the agent listens on. Write wss://host:port for an agent that serves TLS."
                />
                <Input
                    label="Setup PIN"
                    value={form.draft.registrationSecret}
                    onChange={(event) => form.set("registrationSecret", event.target.value)}
                    error={form.errors.registrationSecret}
                    hint="Printed in the agent's log when it starts unregistered."
                    autoComplete="off"
                    autoFocus
                />
            </form>
        </Modal>
    );
};
