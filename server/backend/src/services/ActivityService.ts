import { randomUUID } from "crypto";
import {
    ActivityBatchEnvelopeSchema,
    ActivityEvent,
    ActivityEventSchema,
    ActivityKind,
    ActivityLevel,
    ActivityLevelOverrides,
    ActivityRecord,
    ActivitySubject,
    WS_EVENTS,
    applyLevelOverride,
    firstIssue,
    parseLevelOverrides,
} from "@sadm/shared";
import { logger } from "@sadm/shared/node";
import { appConfig } from "../config/AppConfig.js";
import { ActivityRepository } from "../repositories/ActivityRepository.js";
import { ProxyService } from "./ProxyService.js";
import { WebhookService } from "./WebhookService.js";

/**
 * Tells the dashboards about new events only. They hold the list already, and a new event is
 * the same for everyone, so a delta replaces the full list every event used to cost.
 *
 * The webhooks hear about the same events, for the same reason: only what was inserted just
 * now arrives here, so a batch an agent offers twice reports nothing twice.
 */
function broadcastAppended(records: ActivityRecord[]): void {
    if (records.length === 0) return;
    ProxyService.broadcastToDashboard({
        type: WS_EVENTS.ACTIVITY_APPENDED,
        payload: records,
    });
    WebhookService.dispatch(records);
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

/** What the server itself reports. Everything else is observed on a host, by its agent. */
interface ServerEventInput {
    kind: ActivityKind;
    level: ActivityLevel;
    clientId?: string | null;
    /** When it happened, if not now -- an event dated by the measurement it was read from. */
    occurredAt?: string;
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
     * Records an event the server is the originator of: the connection state of an agent,
     * a registration, an action a user asked for. Everything that happens *on* a host is
     * reported by that host -- the server does not infer it from what it sees.
     *
     * Returns `null` for a kind the settings switch off: nothing is stored and nobody is told.
     */
    static record(input: ServerEventInput): ActivityRecord | null {
        const event = applyLevelOverride<ActivityEvent>(
            {
                id: randomUUID(),
                occurredAt: input.occurredAt ?? new Date().toISOString(),
                source: "server",
                clientId: input.clientId ?? null,
                kind: input.kind,
                level: input.level,
                correlationId: input.correlationId ?? null,
                subject: input.subject ?? null,
                data: input.data ?? null,
            },
            levelOverrides(),
        );
        if (!event) return null;
        const { inserted } = ActivityRepository.insertMany([event], event.occurredAt);
        broadcastAppended(inserted);
        return inserted[0];
    }

    /**
     * Takes a batch from an agent and returns the ids it may drop from its queue.
     *
     * `clientId` and `source` are overwritten with what the connection says rather than
     * trusted from the payload: an agent may only ever speak about itself, and the ack has
     * to cover ids that were actually stored -- an id acknowledged but not written would be
     * dropped on the agent and lost for good.
     *
     * An event of a kind the settings switch off is the other case an id is returned for
     * without a row behind it: it is not wanted, and an agent left without an ack would
     * offer it again on every connection.
     */
    static ingest(clientId: string, events: ActivityEvent[]): string[] {
        const receivedAt = new Date().toISOString();
        const overrides = levelOverrides();
        const kept: ActivityEvent[] = [];
        const switchedOff: string[] = [];
        for (const event of events) {
            const applied = applyLevelOverride(event, overrides);
            if (applied) kept.push(applied);
            else switchedOff.push(event.id);
        }
        const owned = kept.map((event) => ({
            ...event,
            source: "agent" as const,
            clientId,
        }));
        const { storedIds, inserted } = ActivityRepository.insertMany(owned, receivedAt);
        broadcastAppended(inserted);
        return [...storedIds, ...switchedOff];
    }

    /**
     * Handles one `ACTIVITY` batch from an agent and acknowledges what it may drop.
     *
     * Never acknowledge what was not stored -- unless it can never be stored. An ack the
     * agent acts on deletes the event on the one side that still had it, so anything the
     * server merely failed to write stays unacknowledged and arrives again; the ids it
     * carries make the second copy a no-op.
     *
     * An event this build cannot parse is the exception. Re-offering it changes nothing:
     * the next connection reads it with the same schema and fails again, and because the
     * agent hands its queue over in order, that one event would block everything behind it
     * until `MAX_QUEUE_AGE_MS` expires. So it is acknowledged and logged as long as its id
     * can still be read -- one lost observation instead of a queue that stops moving.
     *
     * The events are therefore parsed one by one; only the envelope has to be sound for
     * anything at all to be read from it.
     */
    static handleBatch(clientId: string, payload: unknown): void {
        const parsed = ActivityBatchEnvelopeSchema.safeParse(payload);
        if (!parsed.success) {
            logger.warn(
                { clientId, error: firstIssue(parsed.error) },
                "Discarding malformed ACTIVITY batch from agent",
            );
            return;
        }

        const events: ActivityEvent[] = [];
        // Ids of events that will never parse. Acknowledged without being stored, which is
        // what keeps the agent's queue moving.
        const unreadable: string[] = [];
        for (const candidate of parsed.data.events) {
            const event = ActivityEventSchema.safeParse(candidate);
            if (event.success) {
                events.push(event.data);
                continue;
            }
            const id = (candidate as { id?: unknown } | null)?.id;
            if (typeof id === "string" && id.length > 0) {
                unreadable.push(id);
                logger.warn(
                    { clientId, id, error: firstIssue(event.error) },
                    "Acknowledging an unreadable activity event without storing it",
                );
            } else {
                // Nothing to acknowledge it by, so it is simply dropped. It no longer holds
                // up the events around it.
                logger.warn(
                    { clientId, error: firstIssue(event.error) },
                    "Discarding an activity event without a usable id",
                );
            }
        }

        const ids = [...this.ingest(clientId, events), ...unreadable];
        // An ack over nothing tells the agent nothing; it keeps what it offered either way.
        if (ids.length === 0) return;
        try {
            ProxyService.sendFireAndForget(clientId, WS_EVENTS.ACTIVITY_ACK, { ids });
        } catch {
            // The agent went away between its batch and this ack. It will offer the same
            // events again on its next connection.
        }
    }

    /**
     * Tells the sessions of `userId` which events turned seen -- only theirs: what one user
     * has seen changes nobody else's list. Nothing is sent when nothing changed.
     */
    static markManySeen(ids: string[], userId: number): void {
        const marked = ActivityRepository.markManySeen(ids, userId);
        if (marked.length === 0) return;
        ProxyService.sendToUser(userId, {
            type: WS_EVENTS.ACTIVITY_SEEN,
            payload: { ids: marked },
        });
    }

    /** An empty list is the same for everyone, so it goes to every dashboard. */
    static deleteAll(): void {
        ActivityRepository.deleteAll();
        ProxyService.broadcastToDashboard({
            type: WS_EVENTS.ACTIVITY_UPDATE,
            payload: [],
        });
    }
}
