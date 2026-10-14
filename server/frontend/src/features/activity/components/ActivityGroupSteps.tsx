import { AlertCircle, AlertTriangle, Footprints, Info } from "lucide-react";
import { ActivityLevel, ActivityRecord, activityMessage } from "@sadm/shared";
import { formatTime } from "../../../utils";

const stepIcon: Record<ActivityLevel, React.ReactNode> = {
    error: <AlertCircle size={12} className="text-error shrink-0" />,
    warning: <AlertTriangle size={12} className="text-warning shrink-0" />,
    info: <Info size={12} className="text-info shrink-0" />,
    trace: <Footprints size={12} className="text-text-muted shrink-0" />,
};

/**
 * The members of one correlated group -- an operation and everything it caused.
 *
 * They used to be a `steps` column on the entry they belonged to: a list of sentences the
 * server had appended, with no id, no level and no life of their own. They are ordinary
 * events now, which is why this renders exactly what the top-level list renders, only
 * smaller: each one can be filtered, carries its own level and its own timestamp, and
 * arrives whenever it arrives rather than within a window the server kept open for it.
 */
export function ActivityGroupSteps({ members }: { members: ActivityRecord[] }) {
    return (
        <ul className="mt-1 space-y-0.5">
            {members.map((member) => (
                <li key={member.id} className="flex items-start gap-2 text-xs text-text-muted">
                    <span className="tabular-nums shrink-0">
                        {formatTime(member.occurredAt)}
                    </span>
                    <span className="mt-0.5 shrink-0">{stepIcon[member.level]}</span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{activityMessage(member)}</span>
                </li>
            ))}
        </ul>
    );
}
