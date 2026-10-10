import { CLIENT_STATUS, type ActivityRecord } from "@sadm/shared";
import { groupActivity } from "../../activity/lib/groupActivity";
import { plural } from "../../../utils";

/**
 * The numbers the dashboard's cards and the sidebar's badge both show. Counted here, once,
 * so the two cannot disagree about how many clients are online.
 */

export interface OnlineCount {
    online: number;
    total: number;
}

export const clientCount = (clients: readonly { status?: string | null }[]): OnlineCount => ({
    online: clients.filter((c) => c.status === CLIENT_STATUS.ONLINE).length,
    total: clients.length,
});

/** `3/5`, as a card and a badge write it. Without spaces: the badge sits next to a long label. */
export const formatOnlineCount = ({ online, total }: OnlineCount): string => `${online}/${total}`;

/** The rows the user has not seen that ask for a look, by how loudly. */
export interface UnseenProblems {
    errors: number;
    warnings: number;
}

/**
 * What the activity list opens on from the Errors / Warnings card: unseen rows at warning
 * and above, counted as rows -- grouped the way the list groups them, each at the level its
 * row carries.
 */
export function unseenProblems(events: ActivityRecord[]): UnseenProblems {
    let errors = 0;
    let warnings = 0;
    for (const group of groupActivity(events)) {
        if (!group.unseen) continue;
        if (group.level === "error") errors++;
        else if (group.level === "warning") warnings++;
    }
    return { errors, warnings };
}

/**
 * What the "Errors / Warnings" card says below its number: what the number is made of.
 * A part that is zero is left out, and with nothing unseen the card says that instead.
 */
export function problemSummary({ errors, warnings }: UnseenProblems): string {
    const parts = [
        errors > 0 ? plural(errors, "error") : null,
        warnings > 0 ? plural(warnings, "warning") : null,
    ].filter((part) => part !== null);
    return parts.length > 0 ? parts.join(" · ") : "Nothing unseen";
}

/** What the directory card says below its number: what the number is made of. */
export function objectSummary(counts: { users: number; groups: number; computers: number } | null): string {
    if (!counts) return "Not counted yet";
    return [plural(counts.users, "user"), plural(counts.groups, "group"), plural(counts.computers, "computer")].join(" · ");
}

/** What the domain controllers card says below its number: how many are away, or that none is. */
export function hostSummary({ online, total }: OnlineCount): string {
    if (total === 0) return "No domain controller registered";
    return online === total ? "All connected" : `${total - online} offline`;
}
