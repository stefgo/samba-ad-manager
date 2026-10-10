import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { CONNECTION_MODE, ConnectionMode } from "@sadm/shared";
import { cn, FOCUS_RING } from "@stefgo/react-ui-components";

interface StepConnectionModeProps {
    mode: ConnectionMode;
    onChange: (mode: ConnectionMode) => void;
}

const OPTIONS = [
    {
        mode: CONNECTION_MODE.INBOUND,
        icon: ArrowDownToLine,
        title: "The agent connects to this server",
        description:
            "You get a registration token and enter it on the agent's own web page. Use this when the agent can reach the server, but not the other way around.",
    },
    {
        mode: CONNECTION_MODE.OUTBOUND,
        icon: ArrowUpFromLine,
        title: "This server connects to the agent",
        description:
            "The server dials the agent's web server and registers itself. Use this when the server can reach the agent, for example on a host without a public address of its own.",
    },
] as const;

/**
 * The one decision everything after it depends on. It is a step of its own rather than a
 * toggle above the form because the two branches ask for entirely different things -- a
 * token to carry away, or an address to dial right now.
 */
export const StepConnectionMode = ({ mode, onChange }: StepConnectionModeProps) => (
    <fieldset className="space-y-3 border-0 p-0 m-0">
        <legend className="text-sm text-text-muted mb-3">
            Which side opens the connection?
        </legend>

        {OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = mode === option.mode;
            return (
                <label
                    key={option.mode}
                    className={cn(
                        "flex gap-4 p-4 rounded-lg border cursor-pointer transition-colors",
                        selected
                            ? "border-primary bg-hover"
                            : "border-border hover:bg-hover",
                        FOCUS_RING,
                    )}
                >
                    <input
                        type="radio"
                        name="connection-mode"
                        className="sr-only"
                        checked={selected}
                        onChange={() => onChange(option.mode)}
                    />
                    <Icon
                        size={20}
                        className={cn(
                            "shrink-0 mt-0.5",
                            selected ? "text-primary" : "text-text-muted",
                        )}
                    />
                    <div>
                        <div className="text-sm font-medium text-text-primary">
                            {option.title}
                        </div>
                        <p className="text-xs text-text-muted mt-1">{option.description}</p>
                    </div>
                </label>
            );
        })}
    </fieldset>
);
