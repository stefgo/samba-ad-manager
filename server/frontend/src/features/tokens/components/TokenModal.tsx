import { Button, CopyField, Modal } from "@stefgo/react-ui-components";
import { DEFAULT_AGENT_PORT } from "@sadm/shared";
import { formatDate } from "../../../utils";

interface TokenModalProps {
    token: string;
    expiresAt: string;
    /** The name the token gives the client it creates, where one was entered. */
    displayName?: string;
    /** The address or network the token can be redeemed from, where one was entered. */
    allowedIp?: string;
    onClose: () => void;
}

/**
 * The registration token, shown the one time it exists in the clear, and what to do with it.
 *
 * Escape and a click beside the dialog are both refused: dismissing it is not a way out
 * here, it is losing the value the whole flow was for. The button below is the way out, and
 * it is the only one — which is exactly the case the library's `closeOnEscape` exists for.
 */
export const TokenModal = ({ token, expiresAt, displayName, allowedIp, onClose }: TokenModalProps) => (
    <Modal
        isOpen
        onClose={onClose}
        title="New Registration Token"
        description="Hand this token to the agent — it is shown only once."
        size="lg"
        closeOnEscape={false}
        closeOnOverlayClick={false}
        hideCloseButton
        footer={
            <Button variant="primary" onClick={onClose} className="w-full">
                Done
            </Button>
        }
    >
        <div className="p-6 space-y-4">
            {/* Over plain HTTP there is no clipboard; the field then selects the token
                instead, one keystroke from copied, and says so. */}
            <CopyField
                value={token}
                aria-label="Registration token"
                labels={{
                    unavailable:
                        "Copying is not available on this connection — the token is selected, press Ctrl/⌘+C.",
                }}
            />

            <div className="text-xs text-text-muted">
                Expires: {formatDate(expiresAt)}
            </div>

            <ol className="space-y-2 text-sm text-text-secondary list-decimal pl-5">
                <li>
                    Open the agent's web page at{" "}
                    <span className="font-mono text-text-primary">http://&lt;host&gt;:{DEFAULT_AGENT_PORT}</span>.
                </li>
                <li>Paste the token there and register. The domain controller then appears in the list.</li>
            </ol>

            {(displayName || allowedIp) && (
                <p className="text-xs text-text-muted">
                    The token carries
                    {displayName && (
                        <> the name <span className="text-text-primary">{displayName}</span></>
                    )}
                    {displayName && allowedIp && " and"}
                    {allowedIp && (
                        <>
                            {" "}the network <span className="font-mono text-text-primary">{allowedIp}</span> — it
                            can only be redeemed from there
                        </>
                    )}
                    .
                </p>
            )}
        </div>
    </Modal>
);
