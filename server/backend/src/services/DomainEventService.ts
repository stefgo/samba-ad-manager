import crypto from "crypto";
import {
    WS_EVENTS,
    buildDomainHealth,
    domainHealthOptionsFromSettings,
    issueTimingFromSettings,
    type ActivityKind,
    type DcHealth,
    type DomainHealth,
    type DomainIssueState,
    type IssueTiming,
} from "@sadm/shared";
import { logger } from "../core/logger.js";
import { DomainIncidentRepository } from "../repositories/DomainIncidentRepository.js";
import { ActivityService } from "./ActivityService.js";
import { DashboardHub } from "./DashboardHub.js";
import { DcHealthService } from "./DcHealthService.js";
import { DnsServerHealthService } from "./DnsServerHealthService.js";
import { ServiceUrlHealthService } from "./ServiceUrlHealthService.js";
import { DomainControllerService } from "./DomainControllerService.js";
import { SettingsService } from "./SettingsService.js";
import {
    eventSeverity,
    incidentFacts,
    reportAt,
    trackIncidents,
    type IncidentEvent,
    type IncidentEventKind,
    type TrackedIncident,
} from "./domainIncidentTracker.js";

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

/** The activity kind each step of an incident is recorded as. */
const EVENT_KINDS: Record<IncidentEventKind, ActivityKind> = {
    opened: "domain.issue_opened",
    extended: "domain.issue_extended",
    escalated: "domain.issue_escalated",
    resolved: "domain.issue_resolved",
    discarded: "domain.issue_discarded",
};

/**
 * Turns the findings about the domain into events, one incident per domain controller and
 * one for the domain: when the first finding of an incident has lasted long enough to be
 * reported, when another joins it, when a reported warning has lasted as an error, when the
 * last is gone -- and, off unless switched on, when one was over before it was reported.
 * Those are what the activity list shows and what the webhooks deliver. Every event carries
 * all the findings of its incident, with what each went through.
 *
 * The findings themselves are not this service's: `buildDomainHealth` derives them from the
 * measurements, the same function the dashboard uses. What is decided here is only when they
 * are worth telling -- see `trackIncidents`. The incidents live in memory; what has to outlast
 * a restart, the reported ones, is kept in the database as well. Where each finding stands
 * goes to the dashboards, so they can say of one that it is not reported yet.
 */
export class DomainEventService {
    private static startedAt = 0;
    private static scheduled: NodeJS.Timeout | null = null;
    private static lastSent = "";
    private static incidents: TrackedIncident[] = [];

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
        return buildDomainHealth(
            DomainControllerService.list(),
            states,
            { ...this.options(), now },
            DnsServerHealthService.getAll(),
            ServiceUrlHealthService.getAll(),
        );
    }

    /** Where every finding that is there stands with the activity, as the dashboards are told. */
    static issueStates(): DomainIssueState[] {
        const timing = this.timing();
        return this.incidents
            .flatMap((incident) => incident.findings)
            .filter((finding) => finding.state !== "gone")
            .map((finding) => ({
                id: finding.id,
                state: finding.state === "reported" ? ("open" as const) : ("pending" as const),
                since: finding.since,
                reportAt: finding.state === "pending" ? reportAt(finding, timing) : null,
                openedAt: finding.reportedAt,
            }))
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    static start(): void {
        this.startedAt = Date.now();
        this.incidents = DomainIncidentRepository.findOpen();
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
        ServiceUrlHealthService.onUpdate(soon);
        DomainControllerService.onChange(soon);
        setInterval(() => this.evaluate(), TICK_MS).unref?.();
    }

    private static evaluate(): void {
        const now = Date.now();
        if (now - this.startedAt < STARTUP_GRACE_MS) return;
        try {
            const domain = this.current(now);
            const step = trackIncidents(this.incidents, domain.issues, now, this.timing(), () => crypto.randomUUID());
            DomainIncidentRepository.replaceOpen(step.incidents);
            this.incidents = step.incidents;
            for (const event of step.events) this.record(event, domain, now);
            this.announceStates();
        } catch (err) {
            logger.warn({ err }, "Could not evaluate the domain's findings");
        }
    }

    /** One step of an incident, in the activity: the incident with all its findings, and the state the domain is in. */
    private static record(event: IncidentEvent, domain: DomainHealth, now: number): void {
        const { incident } = event;
        const severity = eventSeverity(event);
        ActivityService.record({
            kind: EVENT_KINDS[event.kind],
            level: event.kind === "resolved" || event.kind === "discarded" ? "info" : severity === "error" ? "error" : "warning",
            dcId: incident.dcId,
            correlationId: incident.correlationId,
            subject: incident.dc ? { name: incident.dc } : null,
            data: { domain: domain.dnsName, status: domain.status, ...incidentFacts(event, now) },
        });
    }

    /** Tells the dashboards where the findings stand, when that changed since it was last told. */
    private static announceStates(): void {
        const states = this.issueStates();
        const sent = JSON.stringify(states);
        if (sent === this.lastSent) return;
        this.lastSent = sent;
        DashboardHub.broadcast({ type: WS_EVENTS.DOMAIN_ISSUES_UPDATE, payload: states });
    }
}
