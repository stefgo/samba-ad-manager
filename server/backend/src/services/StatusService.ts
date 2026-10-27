import { answeringCount, countFindings, type StatusReport } from "@sadm/shared";
import { appVersion } from "../core/version.js";
import { DomainEventService } from "./DomainEventService.js";

/**
 * The status report of `GET /api/v1/status`: the domain's verdict and its findings, as the
 * dashboard shows them.
 *
 * Nothing is judged here. The verdict and the findings are `buildDomainHealth`'s, called
 * through `DomainEventService.current()` on the same inputs the dashboard hands it, so the
 * two cannot disagree; since when a finding stands is what the incident tracking knows of it.
 */
export class StatusService {
    static report(now = Date.now()): StatusReport {
        const domain = DomainEventService.current(now);
        const since = new Map(DomainEventService.issueStates().map((state) => [state.id, state.since]));
        const findings = domain.issues.map((issue) => ({
            id: issue.id,
            type: issue.type,
            severity: issue.severity,
            text: issue.text,
            since: since.get(issue.id) ?? null,
        }));
        return {
            app: "sadm",
            version: appVersion,
            status: domain.status,
            checkedAt: new Date(now).toISOString(),
            counts: countFindings(findings),
            summary: {
                domain: domain.dnsName,
                controllers: answeringCount(domain.controllers),
                objects: domain.counts,
            },
            findings,
        };
    }
}
