import { randomUUID } from "crypto";
import {
    WS_EVENTS,
    applyLevelOverride,
    parseLevelOverrides,
    type ActivityEvent,
    type ActivityKind,
    type ActivityLevel,
    type ActivityLevelOverrides,
    type ActivityRecord,
    type ActivitySubject,
} from "@sadm/shared";
import { appConfig } from "../config/AppConfig.js";
import { ActivityRepository } from "../repositories/ActivityRepository.js";
import { DashboardHub } from "./DashboardHub.js";
import { WebhookService } from "./WebhookService.js";

/**
 * Tells the dashboards about a new event only. They hold the list already, and a new event
 * is the same for everyone, so a delta replaces the full list every event used to cost. The
 * webhooks hear about the same event.
 */
function announce(record: ActivityRecord): void {
    DashboardHub.broadcast({ type: WS_EVENTS.ACTIVITY_APPENDED, payload: [record] });
    WebhookService.dispatch([record]);
}

let parsedOverrides: { text: string; overrides: ActivityLevelOverrides } | null = null;

/**
 * The `activity_level_overrides` setting, read when an event is written and parsed again
 * only when its text has changed. Applied here and nowhere else, so the level in the
 * database, on the dashboards and in front of the webhooks is the same one -- and a changed
 * setting says something about the events from then on, not about the ones already stored.
 */
function levelOverrides(): ActivityLevelOverrides {
    const text = appConfig.settings.activity_level_overrides ?? "";
    if (parsedOverrides?.text !== text) {
        parsedOverrides = { text, overrides: parseLevelOverrides(text).overrides };
    }
    return parsedOverrides.overrides;
}

/** What an event is recorded from. */
interface EventInput {
    kind: ActivityKind;
    level: ActivityLevel;
    /** The domain controller the event is about, where it is about one. */
    dcId?: string | null;
    correlationId?: string | null;
    subject?: ActivitySubject | null;
    data?: Record<string, unknown> | null;
}

export class ActivityService {
    /** The list as `userId` sees it: `seen` is theirs. */
    static list(userId: number): ActivityRecord[] {
        return ActivityRepository.list(userId);
    }

    /**
     * Records an event: a finding about the domain, a change somebody made to the directory,
     * a domain controller that joined or left.
     *
     * Returns `null` for a kind the settings switch off: nothing is stored and nobody is told.
     */
    static record(input: EventInput): ActivityRecord | null {
        const event = applyLevelOverride<ActivityEvent>(
            {
                id: randomUUID(),
                occurredAt: new Date().toISOString(),
                dcId: input.dcId ?? null,
                kind: input.kind,
                level: input.level,
                correlationId: input.correlationId ?? null,
                subject: input.subject ?? null,
                data: input.data ?? null,
            },
            levelOverrides(),
        );
        if (!event) return null;
        const record = ActivityRepository.insert(event);
        announce(record);
        return record;
    }

    /**
     * Tells the sessions of `userId` which events turned seen -- only theirs: what one user
     * has seen changes nobody else's list. Nothing is sent when nothing changed.
     */
    static markManySeen(ids: string[], userId: number): void {
        const marked = ActivityRepository.markManySeen(ids, userId);
        if (marked.length === 0) return;
        DashboardHub.sendToUser(userId, {
            type: WS_EVENTS.ACTIVITY_SEEN,
            payload: { ids: marked },
        });
    }

    /** An empty list is the same for everyone, so it goes to every dashboard. */
    static deleteAll(): void {
        ActivityRepository.deleteAll();
        DashboardHub.broadcast({
            type: WS_EVENTS.ACTIVITY_UPDATE,
            payload: [],
        });
    }
}
