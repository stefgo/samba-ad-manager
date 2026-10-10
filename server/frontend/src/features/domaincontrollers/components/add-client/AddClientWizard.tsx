import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { CONNECTION_MODE, type CreatedToken } from "@sadm/shared";
import { Card, Wizard, WizardStep } from "@stefgo/react-ui-components";
import { useUnsavedChangesGuard } from "../../../../hooks/useUnsavedChangesGuard";
import { createClientToken } from "../../../../queries/clients";
import { getErrorMessage } from "../../../../utils";
import { TokenModal } from "../../../tokens/components/TokenModal";
import { StepConnectionMode } from "./steps/StepConnectionMode";
import { StepInboundDetails } from "./steps/StepInboundDetails";
import { StepOutboundDetails } from "./steps/StepOutboundDetails";
import { useAddClientForm } from "./useAddClientForm";
import { HeaderBreadcrumb } from "../../../app/HeaderBreadcrumb";

interface AddClientWizardProps {
    onCreateOutbound: (data: {
        hostname: string;
        outboundTargetAddress: string;
        registrationSecret: string;
    }) => Promise<void>;
    /** Reloads the token list, so a freshly issued token shows up in it. */
    onTokenCreated: () => void;
}

/**
 * One flow for both connection modes, replacing the separate "Add Outbound Client" dialog
 * and "Generate New Token" button. Which side opens the connection is the first decision,
 * and everything after it follows from that — as two entry points it was a decision the
 * operator had to have made before they got to a form.
 *
 * It lives in the workspace rather than in a modal: the two branches end in different
 * things — a token to carry to another machine, or a connection attempt that may fail with
 * a reason worth reading — and that is more than a dialog should hold.
 *
 * Leaving is a navigation to the client list, the flow's parent in the route tree, and asks
 * first once anything has been entered (`useUnsavedChangesGuard`).
 */
export const AddClientWizard = ({
    onCreateOutbound,
    onTokenCreated,
}: AddClientWizardProps) => {
    const form = useAddClientForm();
    const [step, setStep] = useState(0);
    const [isFinishing, setIsFinishing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);

    // Escape is used up while the token is on screen: that dialog refuses Escape of its
    // own accord, because the token is shown exactly once.
    const hasToken = createdToken !== null;
    const holdOnEscape = useCallback(() => hasToken, [hasToken]);
    // Once the token exists the fields have done their work; there is nothing left to lose.
    const { close, leave } = useUnsavedChangesGuard(form.isDirty && !hasToken, "newClient", {
        onEscape: holdOnEscape,
    });

    const isInbound = form.mode === CONNECTION_MODE.INBOUND;

    const finish = async () => {
        setIsFinishing(true);
        setError(null);
        try {
            if (isInbound) {
                const token = await createClientToken({
                    displayName: form.displayName.trim() || undefined,
                    inboundAllowedIp: form.restrictIp ? form.allowedIp.trim() : undefined,
                });
                setCreatedToken(token);
                onTokenCreated();
            } else {
                await onCreateOutbound({
                    hostname: form.hostname.trim() || form.targetAddress.trim(),
                    outboundTargetAddress: form.targetAddress.trim(),
                    registrationSecret: form.registrationSecret.trim(),
                });
                leave();
            }
        } catch (e: unknown) {
            // The wizard stays on the step, next to the button that retries it. For the
            // outbound branch this is where the agent's own reason for refusing appears.
            setError(getErrorMessage(e));
        } finally {
            setIsFinishing(false);
        }
    };

    const steps: WizardStep[] = [
        {
            id: "mode",
            label: "Connection",
            description: "Which side dials",
            content: <StepConnectionMode mode={form.mode} onChange={form.setMode} />,
        },
        {
            id: "details",
            label: "Agent",
            description: isInbound ? "Get registration token" : "Where to dial",
            canContinue: form.canContinue,
            content: (
                <div className="space-y-4">
                    {isInbound ? (
                        <StepInboundDetails form={form} />
                    ) : (
                        <StepOutboundDetails form={form} />
                    )}
                    {error && <p className="text-sm text-error">{error}</p>}
                </div>
            ),
        },
    ];

    return (
        <>
            <Card
                title={<HeaderBreadcrumb current="Add Domain Controller">Add Domain Controller</HeaderBreadcrumb>}
                classNames={{ header: "py-6 px-7" }}
            >
                <Wizard
                    steps={steps}
                    value={step}
                    onChange={setStep}
                    onCancel={close}
                    onFinish={finish}
                    finishLabel={isInbound ? "Generate Token" : "Add Domain Controller"}
                    finishIcon={Plus}
                    isFinishing={isFinishing}
                    allowStepSelect
                />
            </Card>

            {createdToken && (
                <TokenModal
                    token={createdToken.token}
                    expiresAt={createdToken.expiresAt}
                    displayName={form.displayName.trim() || undefined}
                    allowedIp={form.restrictIp ? form.allowedIp.trim() || undefined : undefined}
                    onClose={() => leave()}
                />
            )}
        </>
    );
};
