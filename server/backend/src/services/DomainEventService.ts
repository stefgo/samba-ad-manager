import crypto from "crypto";
import {
    WS_EVENTS,
    buildDomainHealth,
    domainHealthOptionsFromSettings,
    issueTimingFromSettings,
    type DcHealth,
    type DomainHealth,
    type DomainIssueState,
    type IssueTiming,
} from "@sadm/shared";
import { logger } from "../core/logger.js";
import { DomainIssueRepository } from "../repositories/DomainIssueRepository.js";
import { ActivityService } from "./ActivityService.js";
import { DashboardHub } from "./DashboardHub.js";
import { DcHealthService } from "./DcHealthService.js";
import { DnsServerHealthService } from "./DnsServerHealthService.js";
import { DomainControllerService } from "./DomainControllerService.js";
import { SettingsService } from "./SettingsService.js";
import { reportAt, staleAfterDowntime, trackIssues, type TrackedIssue } from "./domainIssueTracker.js";

/**
 * How often the findings are looked at when nothing prompts it: a wait has to run out
 * somewhere. The shortest wait that can be set is a minute, so one is kept to within a
 * quarter of itself; a wait of 0 is met by the evaluation that follows the measurement.
 */
const TICK_MS = 15_000;

/**
 * How long after its start the server says nothing: until the first round of measurements
 * has come in. What is stored from before the restart describes a moment that is over.
 */
const STARTUP_GRACE_MS = 90_000;

/**
 * Turns the findings about the domain into events: one when a finding has lasted long enough
 * to be reported, one when a reported warning has lasted as an error, one when it has gone.
 * Those are what the activity list shows and what the webhooks deliver.
 *
 * The findings themselves are not this service's: `buildDomainHealth` derives them from the
 * measurements, the same function the dashboard uses. What is decided here is only when one
 * is worth telling -- see `trackIssues`. Where each finding stands with that goes to the
 * dashboards as well, so they can say of one that it is not reported yet.
 */
export class DomainEventService {
    private static startedAt = 0;
    private static resumed = false;
    private static scheduled: NodeJS.Timeout | null = null;
    private static lastSent = "";

    /** The thresholds the findings are judged by, as the settings hold them. */
    static options() {
        return domainHealthOptionsFromSettings(SettingsService.getAllSettings());
    }

    /** The waits the findings are reported and called off after, as the settings hold them. */
    static timing(): IssueTiming {
        return issueTimingFromSettings(SettingsService.getAllSettings());
    }

    /** The domain as it stands, from the domain controllers the directory lists and what is known of each. */
    static current(now = Date.now()): DomainHealth {
        const states: Record<string, DcHealth> = {};
        for (const health of DcHealthService.getAll()) states[health.dcId] = health;
        return buildDomainHealth(DomainControllerService.list(), states, { ...this.options(), now }, DnsServerHealthService.getAll());
    }

    /** Where every tracked finding stands with the activity, as the dashboards are told. */
    static issueStates(): DomainIssueState[] {
        const timing = this.timing();
        return DomainIssueRepository.findAll()
            .map((row) => ({
                id: row.id,
                state: row.state,
                since: row.seenSince,
                reportAt: row.state === "pending" ? reportAt(row, timing) : null,
                openedAt: row.openedAt,
            }))
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    static start(): void {
        this.startedAt = Date.now();
        // A change is evaluated shortly after it, so a burst of measurements is one look.
        const soon = () => {
            if (this.scheduled) return;
            this.scheduled = setTimeout(() => {
                this.scheduled = null;
                this.evaluate();
            }, 1000);
            this.scheduled.unref?.();
        };
        DcHealthService.onUpdate(soon);
        DnsServerHealthService.onUpdate(soon);
        DomainControllerService.onChange(soon);
        setInterval(() => this.evaluate(), TICK_MS).unref?.();
    }

    private static evaluate(): void {
        const now = Date.now();
        if (now - this.startedAt < STARTUP_GRACE_MS) return;
        try {
            const domain = this.current(now);
            const timing = this.timing();
            let tracked = DomainIssueRepository.findAll();
            if (!this.resumed) {
                // What was waiting before the restart and has not been seen since may have gone meanwhile.
                const stale = new Set(staleAfterDowntime(tracked, now, timing));
                if (stale.size > 0) {
                    DomainIssueRepository.apply([], [...stale]);
                    tracked = tracked.filter((row) => !stale.has(row.id));
                }
                this.resumed = true;
            }
            const step = trackIssues(tracked, domain.issues, now, timing, () => crypto.randomUUID());
            DomainIssueRepository.apply(step.save, step.remove);

            for (const issue of step.opened) {
                ActivityService.record({
                    kind: "domain.issue_opened",
                    level: issue.severity === "error" ? "error" : "warning",
                    dcId: issue.dcId,
                    correlationId: issue.correlationId,
                    subject: issue.dc ? { name: issue.dc } : null,
                    data: this.facts(issue, domain),
                });
            }

            for (const issue of step.escalated) {
                ActivityService.record({
                    kind: "domain.issue_escalated",
                    level: "error",
                    dcId: issue.dcId,
                    correlationId: issue.correlationId,
                    subject: issue.dc ? { name: issue.dc } : null,
                    data: this.facts(issue, domain),
                });
            }

            for (const issue of step.resolved) {
                ActivityService.record({
                    kind: "domain.issue_resolved",
                    level: "info",
                    dcId: issue.dcId,
                    correlationId: issue.correlationId,
                    subject: issue.dc ? { name: issue.dc } : null,
                    data: {
                        ...this.facts(issue, domain),
                        // How long the problem lasted, not how long it was reported.
                        durationSeconds: Math.max(0, Math.round((now - Date.parse(issue.seenSince)) / 1000)),
                    },
                });
            }

            this.announceStates();
        } catch (err) {
            logger.warn({ err }, "Could not evaluate the domain's findings");
        }
    }

    /** Tells the dashboards where the findings stand, when that changed since it was last told. */
    private static announceStates(): void {
        const states = this.issueStates();
        const sent = JSON.stringify(states);
        if (sent === this.lastSent) return;
        this.lastSent = sent;
        DashboardHub.broadcast({ type: WS_EVENTS.DOMAIN_ISSUES_UPDATE, payload: states });
    }

    /** What an event says about a finding: the finding, and the state the domain is in with or without it. */
    private static facts(issue: TrackedIssue, domain: DomainHealth): Record<string, unknown> {
        return {
            type: issue.type,
            severity: issue.severity,
            dc: issue.dc,
            text: issue.text,
            domain: domain.dnsName,
            status: domain.status,
        };
    }
}
