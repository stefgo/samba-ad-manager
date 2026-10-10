import { type ActivityRecord, activityDetail, activityMessage } from "@sadm/shared";
import { plural } from "../../../utils";

/** A toast for something that went wrong while the page was open. */
export interface ProblemToast {
    variant: "error" | "warning";
    title: string;
    description?: string;
    /** An error stays until it is dismissed; a warning goes by itself. */
    sticky: boolean;
}

/** More new problems than this at once are one toast that counts them. */
export const MAX_SINGLE_TOASTS = 3;

/**
 * What an event is told apart by, for the question "has this been reported": its incident
 * where it belongs to one, else itself. An incident is reported once, when it opens -- its
 * updates and its resolution are steps of the row the first toast pointed to.
 */
export const toastKey = (event: ActivityRecord): string => event.correlationId ?? event.id;

const isProblem = (event: ActivityRecord) => event.level === "error" || event.level === "warning";

function toastOf(event: ActivityRecord): ProblemToast {
    const host = typeof event.data?.clientName === "string" ? event.data.clientName : null;
    const message = activityMessage(event);
    return {
        variant: event.level === "error" ? "error" : "warning",
        // A sentence that names the domain controller itself does not get it a second time.
        title: host && !message.includes(host) ? `${host}: ${message}` : message,
        description: activityDetail(event) ?? undefined,
        sticky: event.level === "error",
    };
}

/**
 * The toasts for the problems in `events` that `known` does not hold yet: unseen events at
 * warning and above, one per incident, oldest first. Past `MAX_SINGLE_TOASTS` they are one
 * toast that counts them -- a list delivered whole after a reconnect may hold a night's worth.
 *
 * `known` is every key that was in the list before, whatever its level: what was there when
 * the page opened is the activity page's to show, not a toast's.
 */
export function problemToasts(events: readonly ActivityRecord[], known: ReadonlySet<string>): ProblemToast[] {
    // Newest first, as the list is: the oldest event of an incident is the last one found.
    const fresh = new Map<string, ActivityRecord>();
    for (const event of events) {
        if (event.seen || !isProblem(event) || known.has(toastKey(event))) continue;
        fresh.set(toastKey(event), event);
    }
    const problems = [...fresh.values()].reverse();
    if (problems.length <= MAX_SINGLE_TOASTS) return problems.map(toastOf);

    const errors = problems.filter((event) => event.level === "error").length;
    const warnings = problems.length - errors;
    return [
        {
            variant: errors > 0 ? "error" : "warning",
            title: `${problems.length} new problems`,
            description: [errors > 0 ? plural(errors, "error") : null, warnings > 0 ? plural(warnings, "warning") : null]
                .filter((part) => part !== null)
                .join(" · "),
            sticky: errors > 0,
        },
    ];
}
