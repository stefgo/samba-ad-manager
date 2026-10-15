import { AlertCircle, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { FOCUS_RING, cn } from "@stefgo/react-ui-components";
import type { DomainIssue } from "@sadm/shared";
import { useNow } from "../../../hooks/useNow";
import { paths } from "../../../lib/paths";
import { useIssueStates } from "../../../queries/dcHealth";
import { issueReportText, issueText } from "../lib/health";

interface IssueListProps {
    issues: readonly DomainIssue[];
    /** Leaves out the name in front of each finding: for the page of that domain controller. */
    withoutName?: boolean;
}

/**
 * What is wrong, one finding per line, errors in red. A finding about a domain controller
 * leads to its page. Under each, how long it has been there and whether the activity has
 * heard of it: one that has not lasted its wait is shown here and nowhere else.
 */
export const IssueList = ({ issues, withoutName }: IssueListProps) => {
    const states = useIssueStates();
    const now = useNow();
    return (
        <ul className="divide-y divide-border">
            {issues.map((issue, index) => {
                const Icon = issue.severity === "error" ? AlertCircle : AlertTriangle;
                const text = withoutName ? issueText(issue) : issue.text;
                const state = states.get(issue.id);
                const report = issueReportText(state, now);
                return (
                    <li key={`${issue.type}-${issue.dc ?? ""}-${index}`} className="flex items-start gap-3 px-4 py-3">
                        <Icon
                            size={16}
                            className={cn("mt-0.5 shrink-0", issue.severity === "error" ? "text-error" : "text-warning")}
                            aria-label={issue.severity}
                        />
                        <div className="min-w-0">
                            {issue.dcId && !withoutName ? (
                                <Link
                                    to={paths.domainController(issue.dcId)}
                                    className={cn("rounded-sm text-sm text-text-primary hover:text-primary", FOCUS_RING)}
                                >
                                    {text}
                                </Link>
                            ) : (
                                <span className="text-sm text-text-primary">{text}</span>
                            )}
                            {report && (
                                <p className={cn("mt-0.5 text-xs", state?.state === "pending" ? "text-text-muted italic" : "text-text-muted")}>
                                    {report}
                                </p>
                            )}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
};
