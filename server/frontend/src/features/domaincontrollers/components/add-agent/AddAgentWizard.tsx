import { useCallback, useState } from "react";
import { Cpu, Plus, X } from "lucide-react";
import { ConnectAgentSchema, type ConnectionMode, type CreatedAgentToken, type DomainController } from "@sadm/shared";
import { ActionButton, Alert, Card, Wizard, type WizardStep } from "@stefgo/react-ui-components";
import { useEntityForm } from "../../../../hooks/useEntityForm";
import { useUnsavedChangesGuard } from "../../../../hooks/useUnsavedChangesGuard";
import { useConnectAgent, useIssueAgentToken } from "../../../../queries/domainControllers";
import { getErrorMessage } from "../../../../utils";
import { HeaderBreadcrumb } from "../../../app/HeaderBreadcrumb";
import { DEFAULT_CONNECTION_MODE, connectAgentDraftFrom, connectAgentFieldOf, connectAgentInputFrom } from "../../lib/agentForm";
import { AgentTokenModal } from "../AgentTokenModal";
import { StepConnectionMode } from "./steps/StepConnectionMode";
import { StepInboundDetails } from "./steps/StepInboundDetails";
import { StepOutboundDetails } from "./steps/StepOutboundDetails";

interface AddAgentWizardProps {
    dc: DomainController;
}

/**
 * Gives a domain controller its agent: one flow for both connection modes. Which side opens
 * the connection is the first decision, and everything after it follows from that -- as two
 * buttons it was a decision the operator had to have made before they got to a form.
 *
 * It lives in the workspace rather than in a modal: the two branches end in different
 * things -- a token to carry to the domain controller, or a connection attempt that may fail
 * with a reason worth reading -- and that is more than a dialog should hold.
 *
 * Leaving is a navigation to the domain controller's page, the flow's parent in the route
 * tree, and asks first once a PIN has been entered (`useUnsavedChangesGuard`).
 */
export const AddAgentWizard = ({ dc }: AddAgentWizardProps) => {
    const issue = useIssueAgentToken();
    const connect = useConnectAgent();
    const [mode, setMode] = useState<ConnectionMode>(DEFAULT_CONNECTION_MODE);
    const [step, setStep] = useState(0);
    const [tokenError, setTokenError] = useState<string | null>(null);
    const [token, setToken] = useState<CreatedAgentToken | null>(null);

    // Held above the wizard, which renders the current step only: going back keeps what was typed.
    const form = useEntityForm({
        schema: ConnectAgentSchema,
        initial: () => connectAgentDraftFrom(dc),
        toInput: connectAgentInputFrom,
        fieldOf: connectAgentFieldOf,
        // The address is filled in already; what makes the form worth sending is the PIN.
        significant: (draft) => ({ registrationSecret: draft.registrationSecret }),
    });

    // Escape is used up while the token is on screen: that dialog refuses Escape of its
    // own accord, because the token is shown exactly once.
    const hasToken = token !== null;
    const holdOnEscape = useCallback(() => hasToken, [hasToken]);
    // Once the token exists the fields have done their work; there is nothing left to lose.
    const { close, leave } = useUnsavedChangesGuard(form.isDirty && !hasToken, "newAgent", { onEscape: holdOnEscape });

    const isInbound = mode === "inbound";

    const finish = async () => {
        if (!isInbound) {
            // A refusal stays on the step, next to the button that retries it: it is the agent's own reason.
            if (await form.submit((data) => connect.mutateAsync({ id: dc.id, data }))) leave();
            return;
        }
        setTokenError(null);
        try {
            setToken(await issue.mutateAsync(dc.id));
        } catch (e: unknown) {
            setTokenError(getErrorMessage(e));
        }
    };

    const error = isInbound ? tokenError : form.saveError;

    const steps: WizardStep[] = [
        {
            id: "mode",
            label: "Connection",
            description: "Which side dials",
            content: <StepConnectionMode mode={mode} onChange={setMode} />,
        },
        {
            id: "details",
            label: "Agent",
            description: isInbound ? "Get registration token" : "Where to dial",
            canContinue: isInbound || form.canSave,
            content: (
                <div className="space-y-4">
                    {error && <Alert>{error}</Alert>}
                    {isInbound ? <StepInboundDetails dcName={dc.name} /> : <StepOutboundDetails form={form} />}
                </div>
            ),
        },
    ];

    return (
        <>
            <Card
                title={
                    <>
                        <Cpu size={18} className="text-text-muted" />
                        <HeaderBreadcrumb current="Add Agent">Add Agent</HeaderBreadcrumb>
                    </>
                }
                action={<ActionButton icon={X} tooltip="Close" onClick={close} />}
            >
                <Wizard
                    steps={steps}
                    value={step}
                    onChange={setStep}
                    onCancel={close}
                    onFinish={() => void finish()}
                    finishLabel={isInbound ? "Generate Token" : "Add Agent"}
                    finishIcon={Plus}
                    isFinishing={isInbound ? issue.isPending : form.isSaving}
                    allowStepSelect
                />
            </Card>

            {token && <AgentTokenModal dcName={dc.name} token={token.token} expiresAt={token.expiresAt} onClose={() => leave()} />}
        </>
    );
};
