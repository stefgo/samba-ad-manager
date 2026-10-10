import type { DcHealth, DomainController, DomainIssue, DomainStatus, IssueSeverity } from "@sadm/shared";
import { formatDuration } from "@sadm/shared";

type Variant = "success" | "warning" | "error" | "neutral";

/** How a status reads on screen, for the domain and for one domain controller alike. */
export const DOMAIN_STATUS: Record<DomainStatus, { label: string; variant: Variant; description: string }> = {
    healthy: { label: "Healthy", variant: "success", description: "Nothing is wrong." },
    degraded: { label: "Degraded", variant: "warning", description: "Something needs a look, but the directory is served." },
    critical: { label: "Critical", variant: "error", description: "Something is broken." },
    unknown: { label: "Unknown", variant: "neutral", description: "No agent reports, so nothing can be said." },
};

export const SEVERITY_VARIANT: Record<IssueSeverity, Variant> = { warning: "warning", error: "error" };

/** The finding without the name of the domain controller in front: for a place that names it already. */
export const issueText = (issue: DomainIssue): string =>
    issue.dc && issue.text.startsWith(`${issue.dc}: `) ? issue.text.slice(issue.dc.length + 2) : issue.text;

/** What a status line says about a domain controller: its worst finding, or that there is none. */
export function controllerSummary(dc: DomainController): string {
    if (dc.issues.length === 0) return dc.status === "unknown" ? "Not measured yet" : "No findings";
    const first = dc.issues.find((issue) => issue.severity === "error") ?? dc.issues[0];
    const more = dc.issues.length - 1;
    return more > 0 ? `${issueText(first)} (+${more} more)` : issueText(first);
}

export interface ReplicationSummary {
    partners: number;
    failing: number;
    /** The oldest "last success" among the inbound links, as ISO time; null when none has one. */
    oldestSuccess: string | null;
}

/** The inbound links of a measurement in three numbers. Null while replication was not read. */
export function replicationSummary(health: DcHealth | null | undefined): ReplicationSummary | null {
    const inbound = health?.replication?.inbound;
    if (!inbound) return null;
    const partners = new Set(inbound.map((link) => link.partner));
    const failing = new Set(inbound.filter((link) => link.consecutiveFailures > 0).map((link) => link.partner));
    const successes = inbound.map((link) => link.lastSuccess).filter((time): time is string => !!time);
    return {
        partners: partners.size,
        failing: failing.size,
        oldestSuccess: successes.length > 0 ? successes.reduce((a, b) => (a < b ? a : b)) : null,
    };
}

/** `+0.4 s`, `−3 min`: how far a domain controller's clock is from the server's. */
export function clockOffsetLabel(offsetMs: number | null | undefined): string {
    if (typeof offsetMs !== "number") return "–";
    const seconds = Math.abs(offsetMs) / 1000;
    if (seconds < 1) return "in sync";
    const sign = offsetMs > 0 ? "+" : "−";
    return `${sign}${seconds < 60 ? `${Math.round(seconds)} s` : formatDuration(seconds)}`;
}

/** `prefork-worker-ldap-2` is a process of the service, not a service of its own. */
export const isServiceProcess = (name: string): boolean => !/^prefork-(worker|master)-/.test(name);
