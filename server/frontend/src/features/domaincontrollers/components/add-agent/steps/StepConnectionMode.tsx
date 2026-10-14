import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import type { ConnectionMode } from "@sadm/shared";
import { cn, FOCUS_RING } from "@stefgo/react-ui-components";

interface StepConnectionModeProps {
    mode: ConnectionMode;
    onChange: (mode: ConnectionMode) => void;
}

const OPTIONS: { mode: ConnectionMode; icon: typeof ArrowDownToLine; title: string; description: string }[] = [
    {
        mode: "inbound",
        icon: ArrowDownToLine,
        title: "The agent connects to this server",
        description:
            "You get a registration token and start the domain controller's container with it. Nothing listens on the domain controller. Use this when it can reach this server.",
    },
    {
        mode: "outbound",
        icon: ArrowUpFromLine,
        title: "This server connects to the agent",
        description:
            "The agent waits on a port of its own, and the server registers it with the setup PIN from its log. Use this when the domain controller cannot reach this server.",
    },
];

/**
 * The one decision everything after it depends on. It is a step of its own rather than a
 * toggle above the form because the two branches ask for entirely different things -- a
 * token to carry away, or an address to dial right now.
 */
export const StepConnectionMode = ({ mode, onChange }: StepConnectionModeProps) => (
    <fieldset className="m-0 space-y-3 border-0 p-0">
        <legend className="mb-3 text-sm text-text-muted">Which side opens the connection?</legend>

        {OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = mode === option.mode;
            return (
                <label
                    key={option.mode}
                    className={cn(
                        "flex cursor-pointer gap-4 rounded-lg border p-4 transition-colors",
                        selected ? "border-primary bg-hover" : "border-border hover:bg-hover",
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
                    <Icon size={20} className={cn("mt-0.5 shrink-0", selected ? "text-primary" : "text-text-muted")} />
                    <div>
                        <div className="text-sm font-medium text-text-primary">{option.title}</div>
                        <p className="mt-1 text-xs text-text-muted">{option.description}</p>
                    </div>
                </label>
            );
        })}
    </fieldset>
);
