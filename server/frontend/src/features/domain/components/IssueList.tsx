import { AlertCircle, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { FOCUS_RING, cn } from "@stefgo/react-ui-components";
import type { DomainIssue } from "@sadm/shared";
import { paths } from "../../../lib/paths";
import { issueText } from "../lib/health";

interface IssueListProps {
    issues: readonly DomainIssue[];
    /** Leaves out the name in front of each finding: for the page of that domain controller. */
    withoutName?: boolean;
}

/** What is wrong, one finding per line, errors in red. A finding about a domain controller leads to its page. */
export const IssueList = ({ issues, withoutName }: IssueListProps) => (
    <ul className="divide-y divide-border">
        {issues.map((issue, index) => {
            const Icon = issue.severity === "error" ? AlertCircle : AlertTriangle;
            const text = withoutName ? issueText(issue) : issue.text;
            return (
                <li key={`${issue.type}-${issue.dc ?? ""}-${index}`} className="flex items-start gap-3 px-4 py-3">
                    <Icon
                        size={16}
                        className={cn("mt-0.5 shrink-0", issue.severity === "error" ? "text-error" : "text-warning")}
                        aria-label={issue.severity}
                    />
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
                </li>
            );
        })}
    </ul>
);
