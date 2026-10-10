import { AlertCircle, AlertTriangle, Footprints, Info } from "lucide-react";
import type { ActivityLevel } from "@sadm/shared";

const icons: Record<ActivityLevel, React.ReactNode> = {
    error: <AlertCircle size={16} className="text-error shrink-0" />,
    warning: <AlertTriangle size={16} className="text-warning shrink-0" />,
    info: <Info size={16} className="text-info shrink-0" />,
    trace: <Footprints size={16} className="text-text-muted shrink-0" />,
};

/** One icon per level, wherever an event is listed. */
export const ActivityLevelIcon = ({ level }: { level: ActivityLevel }) => <>{icons[level]}</>;
