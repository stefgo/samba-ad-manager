import { ACTIVITY_LEVELS } from "./constants.js";
import type { ActivityKind, ActivityLevel } from "./types.js";

/**
 * What an operator may set an event kind to: one of the levels, or `none`, which keeps the
 * event out of the activity altogether. `none` is not a level -- no stored event carries it.
 */
export const ACTIVITY_LEVEL_OVERRIDE_VALUES = [...ACTIVITY_LEVELS, "none"] as const;

export type ActivityLevelOverride = (typeof ACTIVITY_LEVEL_OVERRIDE_VALUES)[number];

/**
 * The kinds that cannot be switched off, only set to another level. A finding is one row of
 * the list, headed by its `domain.issue_opened` and closed by its `domain.issue_resolved`:
 * without the first the row has no head, and without the second it stays a warning for good
 * -- and a webhook that announced it never sends the all-clear.
 */
export const ACTIVITY_KINDS_ALWAYS_RECORDED: readonly string[] = [
    "domain.issue_opened",
    "domain.issue_resolved",
] satisfies ActivityKind[];

/**
 * The level each kind is reported with where nothing is overridden, lowest first. Several
 * for a kind whose level depends on how it went.
 *
 * Only what the settings page shows next to a kind. The levels themselves are set where the
 * events are written, and this has to be kept in step by hand.
 */
export const ACTIVITY_DEFAULT_LEVELS: Record<ActivityKind, readonly ActivityLevel[]> = {
    "dc.discovered": ["info"],
    "dc.removed": ["warning"],
    "scheduler.failed": ["error"],
    "domain.issue_opened": ["warning", "error"],
    "domain.issue_resolved": ["info"],
    "directory.user_created": ["info"],
    "directory.user_updated": ["info"],
    "directory.password_set": ["info"],
    "directory.user_unlocked": ["info"],
    "directory.account_enabled": ["info"],
    "directory.account_disabled": ["info"],
    "directory.group_created": ["info"],
    "directory.group_updated": ["info"],
    "directory.members_added": ["info"],
    "directory.members_removed": ["info"],
    "directory.computer_updated": ["info"],
    "directory.ou_created": ["info"],
    "directory.ou_updated": ["info"],
    "directory.object_moved": ["info"],
    "directory.object_renamed": ["info"],
    "directory.object_deleted": ["info"],
};

/** Kind to override. A map, because a stored event may carry a kind this build does not know. */
export type ActivityLevelOverrides = ReadonlyMap<string, ActivityLevelOverride>;

const isOverride = (value: string): value is ActivityLevelOverride =>
    (ACTIVITY_LEVEL_OVERRIDE_VALUES as readonly string[]).includes(value);

/**
 * Reads the `activity_level_overrides` setting: `kind=level` entries separated by commas or
 * line breaks, e.g. `scheduler.failed=warning, dc.discovered=none`.
 *
 * The kind is not checked against `ACTIVITY_KINDS`: a setting written for another version
 * may name one this build does not know, and it is carried along all the same. `error` is the first
 * entry that cannot be read; the entries that can are returned next to it.
 */
export function parseLevelOverrides(text: string): { overrides: Map<string, ActivityLevelOverride>; error: string | null } {
    const overrides = new Map<string, ActivityLevelOverride>();
    let error: string | null = null;
    const fail = (message: string) => {
        error ??= message;
    };

    for (const raw of text.split(/[,\n]/)) {
        const entry = raw.trim();
        if (entry === "") continue;
        const separator = entry.indexOf("=");
        const kind = separator === -1 ? "" : entry.slice(0, separator).trim();
        const value = separator === -1 ? "" : entry.slice(separator + 1).trim();
        if (kind === "" || /\s/.test(kind)) {
            fail(`"${entry}" is not of the form kind=level`);
        } else if (!isOverride(value)) {
            fail(`${kind}: Must be one of ${ACTIVITY_LEVEL_OVERRIDE_VALUES.join(", ")}`);
        } else if (value === "none" && ACTIVITY_KINDS_ALWAYS_RECORDED.includes(kind)) {
            fail(`${kind}: Cannot be set to none`);
        } else if (overrides.has(kind)) {
            fail(`${kind}: Given more than once`);
        } else {
            overrides.set(kind, value);
        }
    }
    return { overrides, error };
}

/** The setting as it is stored, in the order the entries were made. */
export const formatLevelOverrides = (overrides: ActivityLevelOverrides): string =>
    [...overrides].map(([kind, value]) => `${kind}=${value}`).join(", ");

/**
 * An event as the overrides leave it: itself where its kind is not overridden, a copy with
 * the configured level, or `null` for a kind set to `none`.
 */
export function applyLevelOverride<T extends { kind: string; level: ActivityLevel }>(
    event: T,
    overrides: ActivityLevelOverrides,
): T | null {
    const override = overrides.get(event.kind);
    if (override === undefined || override === event.level) return event;
    if (override === "none") return null;
    return { ...event, level: override };
}
