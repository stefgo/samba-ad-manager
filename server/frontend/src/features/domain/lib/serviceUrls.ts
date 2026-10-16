import { formatDuration, type DomainHealth, type DomainIssueType } from "@sadm/shared";

/**
 * How one central URL stands.
 *
 * - `ok`: it answers, with a certificate that is good for it and has time left.
 * - `expiring`: its certificate expires soon -- a warning or, close to the end, an error.
 * - `certificate`: its certificate is not good for it, or StartTLS is refused.
 * - `down`: the directory does not answer through it.
 */
export type ServiceUrlState = "ok" | "expiring" | "certificate" | "down";

export const SERVICE_URL_STATE_LABELS: Record<ServiceUrlState, string> = {
    ok: "Answers",
    expiring: "Expires soon",
    certificate: "Certificate",
    down: "Does not answer",
};

export interface ServiceUrlRow {
    url: string;
    state: ServiceUrlState;
    tone: "success" | "warning" | "error";
    /** The domain controller that answered, and its id where the directory lists it. */
    answeredBy: string | null;
    dcId?: string;
    /** Why it does not answer, or why its certificate is not good for it. */
    detail: string | null;
    /** When the certificate it presents expires; null without one. */
    validTo: string | null;
}

/** The findings of a URL, by the kind they are of. Order matters: the first that is there decides. */
const STATES: readonly [DomainIssueType, ServiceUrlState][] = [
    ["service-url-down", "down"],
    ["service-url-certificate", "certificate"],
    ["certificate-expiring", "expiring"],
];

/**
 * Every central URL as the dashboard lists it. Read off the domain's findings rather than
 * judged here, so that the list and the findings are one judgement: a finding about a URL
 * is the domain's, its id ends with the URL.
 */
export function serviceUrlRows(domain: Pick<DomainHealth, "serviceUrls" | "controllers" | "issues">): ServiceUrlRow[] {
    return domain.serviceUrls.map((service) => {
        const about = `|${service.url.toLowerCase()}`;
        const found = STATES.map(([type, state]) => ({
            state,
            issue: domain.issues.find((issue) => issue.type === type && !issue.dc && issue.id.endsWith(about)),
        })).find(({ issue }) => issue);
        const dc = service.answeredBy ? domain.controllers.find((other) => other.name.toUpperCase() === service.answeredBy!.toUpperCase()) : undefined;
        return {
            url: service.url,
            state: found?.state ?? "ok",
            tone: !found ? "success" : found.issue!.severity === "error" ? "error" : "warning",
            answeredBy: dc?.name ?? service.answeredBy ?? null,
            ...(dc ? { dcId: dc.id } : {}),
            detail: !service.ok ? (service.detail ?? null) : service.tls && !service.tls.ok ? (service.tls.detail ?? null) : null,
            validTo: service.tls?.certificate?.validTo ?? null,
        };
    });
}

/** How much time a certificate has left: `30 d left`, or `expired`. */
export function certificateLeft(validTo: string, now: number): string {
    const leftMs = Date.parse(validTo) - now;
    if (Number.isNaN(leftMs)) return "";
    return leftMs <= 0 ? "expired" : `${formatDuration(leftMs / 1000)} left`;
}
