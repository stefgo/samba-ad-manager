import { ACTIVITY_LEVELS, ActivityLevel, ActivityRecord } from "@sadm/shared";

/**
 * One row of the list: an event, plus the events that share its correlationId.
 *
 * Grouping is a lookup, not a guess. Whoever caused a group put its id on every member: a
 * finding's announcement and its all-clear carry the same one. Nothing here matches names,
 * and nothing depends on the order or the timing of what arrives.
 */
export interface ActivityGroup {
    head: ActivityRecord;
    members: ActivityRecord[];
    /** The most severe level in the group, so a failed step colours its head. */
    level: ActivityLevel;
    /** True while nobody in the group has been seen by the current user. */
    unseen: boolean;
    /**
     * Events of the group that are not shown, see `supersededIds`. Seeing the group sees
     * them too, or they would stay unseen with no row left to mark them from.
     */
    superseded: ActivityRecord[];
}

/**
 * The kinds that sum up a whole operation and are therefore the head of their group once
 * they are there: the outcome of a fix or a replication, with every attempt in its data.
 * Until it has arrived the earliest event stands in for it.
 */
const GROUP_HEADS = new Set(["agent.dbcheck_fixed", "agent.replication_synced"]);

/**
 * What the server writes when an operation's outcome is late, and the outcome that settles
 * it. Once the outcome has arrived "no answer yet" is no longer true and must not colour
 * the group or count as a warning.
 */
const SUPERSEDED_BY: Record<string, string> = {
    "agent.dbcheck_fix_unconfirmed": "agent.dbcheck_fixed",
    "agent.replication_sync_unconfirmed": "agent.replication_synced",
};

/** The events a later one has overtaken: every "no answer yet" whose group has the answer. */
export function supersededIds(events: readonly ActivityRecord[]): Set<string> {
    const settled = new Set<string>();
    for (const event of events) {
        if (event.correlationId) settled.add(`${event.correlationId}\n${event.kind}`);
    }
    const superseded = new Set<string>();
    for (const event of events) {
        const outcome = SUPERSEDED_BY[event.kind];
        if (outcome && event.correlationId && settled.has(`${event.correlationId}\n${outcome}`)) {
            superseded.add(event.id);
        }
    }
    return superseded;
}

function maxLevel(events: ActivityRecord[]): ActivityLevel {
    let worst: ActivityLevel = ACTIVITY_LEVELS[0];
    for (const event of events) {
        if (ACTIVITY_LEVELS.indexOf(event.level) > ACTIVITY_LEVELS.indexOf(worst)) {
            worst = event.level;
        }
    }
    return worst;
}

/**
 * Folds a flat, newest-first event list into rows.
 *
 * An event with no correlationId is a row of its own. Correlated events become one row
 * headed by the event that sums the operation up (`GROUP_HEADS`), or, until that has
 * arrived, by the earliest of them, the one that started what the others continue. A
 * superseded event is left out of the row and kept in `superseded`.
 */
export function groupActivity(events: ActivityRecord[]): ActivityGroup[] {
    const hidden = supersededIds(events);
    const supersededByCorrelation = new Map<string, ActivityRecord[]>();
    const byCorrelation = new Map<string, ActivityRecord[]>();
    const groups: ActivityGroup[] = [];
    // Placeholders keep the correlated rows in the position of their first-seen member, so
    // a group does not jump to the top of the list every time it grows a step.
    const order: Array<ActivityRecord | { correlationId: string }> = [];

    for (const event of events) {
        const key = event.correlationId;
        if (key && hidden.has(event.id)) {
            supersededByCorrelation.set(key, [...(supersededByCorrelation.get(key) ?? []), event]);
            continue;
        }
        if (!key) {
            order.push(event);
            continue;
        }
        const existing = byCorrelation.get(key);
        if (existing) {
            existing.push(event);
        } else {
            byCorrelation.set(key, [event]);
            order.push({ correlationId: key });
        }
    }

    for (const entry of order) {
        if ("correlationId" in entry && !("id" in entry)) {
            const members = byCorrelation.get(entry.correlationId) ?? [];
            if (members.length === 0) continue;
            // The list arrives newest first; a group reads oldest first, the way it ran.
            const ordered = [...members].reverse();
            const head = ordered.find((m) => GROUP_HEADS.has(m.kind)) ?? ordered[0];
            groups.push({
                head,
                members: ordered.filter((m) => m.id !== head.id),
                level: maxLevel(ordered),
                unseen: ordered.some((m) => !m.seen),
                superseded: supersededByCorrelation.get(entry.correlationId) ?? [],
            });
            continue;
        }
        const event = entry as ActivityRecord;
        groups.push({
            head: event,
            members: [],
            level: event.level,
            unseen: !event.seen,
            superseded: [],
        });
    }

    return groups;
}
