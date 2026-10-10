import crypto from "crypto";
import { buildDomainHealth, domainHealthOptionsFromSettings, type DcHealth, type DomainHealth } from "@sadm/shared";
import { logger } from "@sadm/shared/node";
import { DomainIssueRepository } from "../repositories/DomainIssueRepository.js";
import { ActivityService } from "./ActivityService.js";
import { DcHealthService } from "./DcHealthService.js";
import { ProxyService } from "./ProxyService.js";
import { SettingsService } from "./SettingsService.js";
import { EMPTY_TRACKER_STATE, trackIssues, type OpenIssue, type TrackerState } from "./domainIssueTracker.js";

/** How long a finding has to be there before it is announced, and gone before it is called off. */
const CONFIRM_MS = 45_000;

/** How often the findings are looked at when nothing prompts it: a wait has to run out somewhere. */
const TICK_MS = 15_000;

/**
 * How long after its start the server says nothing. Its agents are reconnecting then, and
 * "every agent is offline" is true of every restart for a few seconds.
 */
const STARTUP_GRACE_MS = 90_000;

/**
 * Turns the findings about the domain into events: one when a finding has appeared, one when
 * it has gone. Those are what the activity list shows and what the webhooks deliver.
 *
 * The findings themselves are not this service's: `buildDomainHealth` derives them from the
 * measurements, the same function the dashboard uses. What is decided here is only when one
 * is worth telling -- see `trackIssues`.
 */
export class DomainEventService {
    private static state: TrackerState = EMPTY_TRACKER_STATE;
    private static startedAt = 0;
    private static scheduled: NodeJS.Timeout | null = null;

    /** The thresholds the findings are judged by, as the settings hold them. */
    static options() {
        return domainHealthOptionsFromSettings(SettingsService.getAllSettings());
    }

    /** The domain as it stands, from the client list and every stored measurement. */
    static current(now = Date.now()): DomainHealth {
        const states: Record<string, DcHealth> = {};
        for (const health of DcHealthService.getAll()) states[health.clientId] = health;
        return buildDomainHealth(ProxyService.getClientsWithStatus(), states, { ...this.options(), now });
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
        ProxyService.onConnectionChange(soon);
        setInterval(() => this.evaluate(), TICK_MS).unref?.();
    }

    private static evaluate(): void {
        const now = Date.now();
        if (now - this.startedAt < STARTUP_GRACE_MS) return;
        try {
            const domain = this.current(now);
            const open = DomainIssueRepository.findAll();
            const step = trackIssues(this.state, open, domain.issues, now, CONFIRM_MS);
            this.state = step.state;

            for (const { id, text } of step.reworded) DomainIssueRepository.updateText(id, text);

            for (const issue of step.opened) {
                const stored: OpenIssue = {
                    id: issue.id,
                    type: issue.type,
                    severity: issue.severity,
                    dc: issue.dc ?? null,
                    clientId: issue.clientId ?? null,
                    text: issue.text,
                    openedAt: new Date(now).toISOString(),
                    correlationId: crypto.randomUUID(),
                };
                DomainIssueRepository.insert(stored);
                ActivityService.record({
                    kind: "domain.issue_opened",
                    level: issue.severity === "error" ? "error" : "warning",
                    clientId: stored.clientId,
                    correlationId: stored.correlationId,
                    subject: stored.dc ? { name: stored.dc } : null,
                    data: this.facts(stored, domain),
                });
            }

            for (const issue of step.resolved) {
                DomainIssueRepository.delete(issue.id);
                ActivityService.record({
                    kind: "domain.issue_resolved",
                    level: "info",
                    clientId: issue.clientId,
                    correlationId: issue.correlationId,
                    subject: issue.dc ? { name: issue.dc } : null,
                    data: {
                        ...this.facts(issue, domain),
                        durationSeconds: Math.max(0, Math.round((now - Date.parse(issue.openedAt)) / 1000)),
                    },
                });
            }
        } catch (err) {
            logger.warn({ err }, "Could not evaluate the domain's findings");
        }
    }

    /** What an event says about a finding: the finding, and the state the domain is in with or without it. */
    private static facts(issue: OpenIssue, domain: DomainHealth): Record<string, unknown> {
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
