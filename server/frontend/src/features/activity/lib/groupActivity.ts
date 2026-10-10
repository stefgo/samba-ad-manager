import { ACTIVITY_LEVELS, ActivityLevel, ActivityRecord } from "@sadm/shared";

/**
 * One row of the list: an event, plus the events that share its correlationId.
 *
 * Grouping is a lookup, not a guess. Whoever caused a group put its id on every member --
 * the agent stamps its run or the server's actionId on what it does, the server stamps the
 * same actionId on the request it sent. Nothing here matches names, and nothing depends on
 * the order or the timing of what arrives: an event delayed by an offline stretch carries
 * its own membership and lands in the right group hours later.
 */
export interface ActivityGroup {
    head: ActivityRecord;
    members: ActivityRecord[];
    /** The most severe level in the group, so a failed step colours its head. */
    level: ActivityLevel;
    /** True while nobody in the group has been seen by the current user. */
    unseen: boolean;
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
 * headed by the earliest of them, the one that started what the others continue.
 */
export function groupActivity(events: ActivityRecord[]): ActivityGroup[] {
    const byCorrelation = new Map<string, ActivityRecord[]>();
    const groups: ActivityGroup[] = [];
    // Placeholders keep the correlated rows in the position of their first-seen member, so
    // a group does not jump to the top of the list every time it grows a step.
    const order: Array<ActivityRecord | { correlationId: string }> = [];

    for (const event of events) {
        const key = event.correlationId;
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
            const head = ordered[0];
            groups.push({
                head,
                members: ordered.filter((m) => m.id !== head.id),
                level: maxLevel(ordered),
                unseen: ordered.some((m) => !m.seen),
            });
            continue;
        }
        const event = entry as ActivityRecord;
        groups.push({
            head: event,
            members: [],
            level: event.level,
            unseen: !event.seen,
        });
    }

    return groups;
}
