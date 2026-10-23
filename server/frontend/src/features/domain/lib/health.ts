import type { ControllerHealth, DcHealth, DcService, DomainIssue, DomainIssueState, DomainStatus, IssueSeverity } from "@sadm/shared";
import { formatDuration } from "@sadm/shared";
import { formatDate, formatTime } from "../../../utils";

type Variant = "success" | "warning" | "error" | "neutral";

/** How a status reads on screen, for the domain and for one domain controller alike. */
export const DOMAIN_STATUS: Record<DomainStatus, { label: string; variant: Variant; description: string }> = {
    healthy: { label: "Healthy", variant: "success", description: "Nothing is wrong." },
    degraded: { label: "Degraded", variant: "warning", description: "Something needs a look, but the directory is served." },
    critical: { label: "Critical", variant: "error", description: "Something is broken." },
    unknown: { label: "Unknown", variant: "neutral", description: "Nothing has been measured yet, so nothing can be said." },
};

/**
 * The dot next to a domain controller. It answers two questions at once: whether the domain
 * controller is there, and whether all is well with it. Red is kept for one that answers
 * nothing; whatever else is wrong with it is yellow -- how bad it is says the badge. One
 * nothing is known about yet is grey.
 */
export function controllerTone(
    dc: Pick<ControllerHealth, "issues" | "status"> | undefined,
): "success" | "warning" | "error" | "unknown" {
    if (dc?.issues.some((issue) => issue.type === "dc-unreachable")) return "error";
    if (!dc || dc.status === "unknown") return "unknown";
    return dc.status === "healthy" ? "success" : "warning";
}

/**
 * The dot in the list of domain controllers: whether the domain controller is there, and
 * nothing else -- how it is doing says the status column next to it. Grey until it has been
 * measured.
 */
export function reachabilityTone(dc: Pick<ControllerHealth, "health" | "issues">): "success" | "error" | "unknown" {
    if (dc.issues.some((issue) => issue.type === "dc-unreachable")) return "error";
    return dc.health ? "success" : "unknown";
}

export const SEVERITY_VARIANT: Record<IssueSeverity, Variant> = { warning: "warning", error: "error" };

/** The finding without the name of the domain controller in front: for a place that names it already. */
export const issueText = (issue: DomainIssue): string =>
    issue.dc && issue.text.startsWith(`${issue.dc}: `) ? issue.text.slice(issue.dc.length + 2) : issue.text;

/** What a status line says about a domain controller: its worst finding, or that there is none. */
export function controllerSummary(dc: Pick<ControllerHealth, "issues" | "status">): string {
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

/**
 * What is said next to a service: how fast it answered, or why it did not. A service that
 * was only connected to is marked as such -- an open port says less than an answer.
 */
export function serviceNote(service: DcService): string {
    if (!service.ok) return service.detail ?? "does not answer";
    const how = service.check === "protocol" ? "answers" : "port open";
    return typeof service.latencyMs === "number" ? `${how} · ${Math.round(service.latencyMs)} ms` : how;
}

/** A moment as a reader needs it: the time on the same day, the date otherwise. */
const momentText = (iso: string, now: number, locale?: string): string =>
    new Date(iso).toDateString() === new Date(now).toDateString() ? formatTime(iso, locale) : formatDate(iso, { locale });

/**
 * Where a finding stands with the activity, in a few words under it: how long it has been
 * there, and whether the activity and the webhooks have heard of it yet. A finding that has
 * not lasted its wait is shown here and nowhere else. Null for one the server has not
 * tracked yet -- it does so within a second, or after its start once it has measured.
 */
export function issueReportText(state: DomainIssueState | undefined, now: number, locale?: string): string | null {
    if (!state) return null;
    const since = `Since ${formatDuration((now - Date.parse(state.since)) / 1000)}`;
    if (state.state === "open") return state.openedAt ? `${since}, reported ${momentText(state.openedAt, now, locale)}` : since;
    if (!state.reportAt) return `${since}, not reported yet`;
    return `${since}, not reported yet: reported at ${momentText(state.reportAt, now, locale)} if it lasts`;
}
