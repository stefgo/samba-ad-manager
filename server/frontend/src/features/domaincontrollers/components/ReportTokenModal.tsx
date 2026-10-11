import { Button, CopyField, Modal } from "@stefgo/react-ui-components";
import { DOCS } from "../../../lib/docs";

interface ReportTokenModalProps {
    dcName: string;
    token: string;
    onClose: () => void;
}

/**
 * The report token, shown the one time it exists in the clear, and what to do with it.
 *
 * Escape and a click beside the dialog are both refused: dismissing it is not a way out
 * here, it is losing the value the whole flow was for. The button below is the way out, and
 * it is the only one.
 */
export const ReportTokenModal = ({ dcName, token, onClose }: ReportTokenModalProps) => (
    <Modal
        isOpen
        onClose={onClose}
        title={`Report token for ${dcName}`}
        description="Give this token to the script on the domain controller — it is shown only once."
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
                aria-label="Report token"
                labels={{
                    unavailable: "Copying is not available on this connection — the token is selected, press Ctrl/⌘+C.",
                }}
            />
            <p className="text-sm text-text-secondary">
                The database check runs on the domain controller itself, from a script started by cron. It reports to this
                server with the token above, as <span className="font-mono text-text-primary">SADM_TOKEN</span>.{" "}
                <a href={DOCS.dbcheck} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    How to set it up
                </a>
                .
            </p>
            <p className="text-xs text-text-muted">
                From now on a report is expected of {dcName}: one that stays away is a finding.
            </p>
        </div>
    </Modal>
);
