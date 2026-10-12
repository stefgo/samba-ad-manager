import {
    ACTIVITY_DEFAULT_LEVELS,
    ACTIVITY_KINDS,
    ACTIVITY_KINDS_ALWAYS_RECORDED,
    ACTIVITY_LEVELS,
    formatLevelOverrides,
    parseLevelOverrides,
    type ActivityKind,
} from "@sadm/shared";

/** The value of a select that overrides nothing. */
export const DEFAULT_CHOICE = "";

/** Which heading a kind stands under, by the part in front of its dot. */
const GROUP_LABELS: Record<string, string> = {
    dc: "Domain controllers",
    agent: "Domain controllers",
    domain: "Domain health",
    directory: "Directory changes",
    scheduler: "Server jobs",
};

export interface EventLevelGroup {
    label: string;
    kinds: ActivityKind[];
}

/**
 * Every kind this build knows, under its heading. Read off `ACTIVITY_KINDS`, so a new kind
 * has its row without anything to add here; one with a prefix nobody named lands in "Other".
 */
export const EVENT_LEVEL_GROUPS: readonly EventLevelGroup[] = (() => {
    const groups = new Map<string, ActivityKind[]>();
    for (const kind of ACTIVITY_KINDS) {
        const label = GROUP_LABELS[kind.split(".")[0]] ?? "Other";
        groups.set(label, [...(groups.get(label) ?? []), kind]);
    }
    return [...groups].map(([label, kinds]) => ({ label, kinds }));
})();

/**
 * What a kind can be set to. "Default" names the level it has when left alone; `none` is
 * missing for a kind that cannot be switched off.
 */
export function levelChoices(kind: ActivityKind): Array<{ value: string; label: string }> {
    return [
        { value: DEFAULT_CHOICE, label: `Default (${ACTIVITY_DEFAULT_LEVELS[kind].join(" / ")})` },
        ...ACTIVITY_LEVELS.map((level) => ({ value: level, label: level })),
        ...(ACTIVITY_KINDS_ALWAYS_RECORDED.includes(kind) ? [] : [{ value: "none", label: "none (not recorded)" }]),
    ];
}

/** What the setting holds for a kind, as its select shows it. */
export const choiceOf = (setting: string, kind: string): string =>
    parseLevelOverrides(setting).overrides.get(kind) ?? DEFAULT_CHOICE;

/**
 * The setting after a select changed. Every other entry stays, including one for a kind
 * this page has no row for -- written by hand, for a kind this build does not know.
 */
export function withChoice(setting: string, kind: string, choice: string): string {
    const { overrides } = parseLevelOverrides(setting);
    overrides.delete(kind);
    if (choice === DEFAULT_CHOICE) return formatLevelOverrides(overrides);
    // Read back through the parser, so what a select can produce is what the server takes.
    const added = parseLevelOverrides(`${kind}=${choice}`).overrides.get(kind);
    if (added) overrides.set(kind, added);
    return formatLevelOverrides(overrides);
}
