import type { ActivityRecord, AnsweringCount } from "@sadm/shared";
import { groupActivity } from "../../activity/lib/groupActivity";
import { plural } from "../../../utils";

/**
 * The numbers the dashboard's cards and the sidebar's badge both show. How many domain
 * controllers answer is counted in `shared`, once, so the cards, the badge and the server's
 * status report cannot disagree about it.
 */
export { answeringCount, type AnsweringCount } from "@sadm/shared";

/** `3/5`, as a card and a badge write it. Without spaces: the badge sits next to a long label. */
export const formatAnsweringCount = ({ answering, total }: AnsweringCount): string => `${answering}/${total}`;

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

/** What the domain controllers card says below its number: how many do not answer, or that all do. */
export function controllerSummary({ answering, total }: AnsweringCount): string {
    if (total === 0) return "None found in the directory yet";
    return answering === total ? "All answer" : `${total - answering} not answering`;
}
