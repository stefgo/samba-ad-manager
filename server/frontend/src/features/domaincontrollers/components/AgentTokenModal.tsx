import { Button, CopyField, Modal } from "@stefgo/react-ui-components";
import { RelativeTime } from "../../../components/RelativeTime";
import { DOCS } from "../../../lib/docs";

interface AgentTokenModalProps {
    dcName: string;
    token: string;
    expiresAt: string;
    /** The token registers an agent in place of the one the domain controller has. */
    replacing?: boolean;
    onClose: () => void;
}

/**
 * The registration token, shown the one time it exists in the clear, and what to do with it.
 *
 * Escape and a click beside the dialog are both refused: dismissing it is not a way out
 * here, it is losing the value the whole flow was for. The button below is the way out, and
 * it is the only one.
 */
export const AgentTokenModal = ({ dcName, token, expiresAt, replacing = false, onClose }: AgentTokenModalProps) => (
    <Modal
        isOpen
        onClose={onClose}
        title={`Registration token for ${dcName}`}
        description="Give this token to the agent on the domain controller — it is shown only once."
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
        <div className="space-y-4 p-6">
            {/* Over plain HTTP there is no clipboard; the field then selects the token
                instead, one keystroke from copied, and says so. */}
            <CopyField
                value={token}
                aria-label="Registration token"
                labels={{
                    unavailable: "Copying is not available on this connection — the token is selected, press Ctrl/⌘+C.",
                }}
            />
            <p className="text-sm text-text-secondary">
                Start the domain controller's container with this server's address as{" "}
                <span className="font-mono text-text-primary">SADM_SERVER_URL</span> and the token as{" "}
                <span className="font-mono text-text-primary">SADM_REGISTRATION_TOKEN</span>. The agent registers when it
                starts and connects from then on.{" "}
                <a href={DOCS.agent} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    How to set it up
                </a>
                .
            </p>
            {replacing && (
                <p className="text-sm text-text-secondary">
                    The agent there reads the token only while it has no identity: delete{" "}
                    <span className="font-mono text-text-primary">identity.json</span> in its data directory first. Until an agent
                    registers with this token, the one registered now is still accepted.
                </p>
            )}
            <p className="text-xs text-text-muted">
                The token is good for {dcName} only, for one registration, and expires <RelativeTime date={expiresAt} />.
            </p>
        </div>
    </Modal>
);
