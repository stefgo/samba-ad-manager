import { AlertCircle, AlertTriangle } from "lucide-react";
import type { IncidentFinding } from "@sadm/shared";
import { cn } from "@stefgo/react-ui-components";
import { formatDate, formatTime } from "../../../utils";

const BADGE = "shrink-0 whitespace-nowrap text-[11px] px-1.5 py-0.5 rounded";

/** "17:38:02 – 17:52:40": from when a finding was there to when it was last seen. */
function span(finding: IncidentFinding): string {
    if (!finding.since) return "";
    return finding.lastSeenAt ? `${formatTime(finding.since)} – ${formatTime(finding.lastSeenAt)}` : formatTime(finding.since);
}

/** The same with the date, for the tooltip: an incident may run past midnight. */
function spanTitle(finding: IncidentFinding): string | undefined {
    if (!finding.since) return undefined;
    const since = formatDate(finding.since, { seconds: true });
    return finding.lastSeenAt ? `${since} – ${formatDate(finding.lastSeenAt, { seconds: true })}` : since;
}

/**
 * Every finding of an incident, under its row in the activity list: what was wrong, how bad
 * it got, whether it was reported, and when it was there. A finding that was gone before its
 * report wait ran out is listed too -- the all-clear counts it, so the reader has to see it.
 */
export function IncidentFindings({ findings }: { findings: IncidentFinding[] }) {
    if (findings.length === 0) return null;
    return (
        <div className="mt-1">
            <p className="text-[11px] uppercase tracking-wide text-text-muted">Findings</p>
            <ul className="mt-0.5 space-y-0.5">
                {findings.map((finding, index) => (
                    <li key={index} className="flex items-start gap-2 text-xs text-text-muted">
                        <span className="mt-0.5 shrink-0">
                            {finding.worstSeverity === "error" ? (
                                <AlertCircle size={12} className="text-error shrink-0" />
                            ) : (
                                <AlertTriangle size={12} className="text-warning shrink-0" />
                            )}
                        </span>
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                            {finding.text}
                            {finding.gaps > 0 && ` (gone and back ${finding.gaps}×)`}
                        </span>
                        <span
                            className={cn(BADGE, finding.reportedAt ? "bg-hover text-text-muted" : "border border-border text-text-muted")}
                            title={finding.reportedAt ? `Reported ${formatDate(finding.reportedAt, { seconds: true })}` : "Gone before its report wait ran out"}
                        >
                            {finding.reportedAt ? "reported" : "not reported"}
                        </span>
                        <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums" title={spanTitle(finding)}>
                            {span(finding)}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
