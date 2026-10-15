import { DOMAIN_ISSUE_LABELS, DOMAIN_ISSUE_TYPES, type DomainIssueType } from "@sadm/shared";

/** Every kind of finding, in the order of the table in the documentation, with its name. */
export const ISSUE_KINDS: readonly { type: DomainIssueType; label: string }[] = DOMAIN_ISSUE_TYPES.map((type) => ({
    type,
    label: DOMAIN_ISSUE_LABELS[type],
}));

/**
 * What the setting holds for a kind, as its field shows it: its minutes, or empty for the
 * default. Read as written, not through the parser, so a value the server would refuse stays
 * in its field while the section says why.
 */
export const minutesOf = (setting: string, type: string): string => {
    for (const raw of setting.split(/[,\n]/)) {
        const separator = raw.indexOf("=");
        if (separator !== -1 && raw.slice(0, separator).trim() === type) return raw.slice(separator + 1).trim();
    }
    return "";
};

/**
 * The setting after the field of a kind changed. Empty takes the kind back to the default.
 * Every other entry stays as written, including one for a kind this page has no field for --
 * written by hand, for a kind this build does not know. A value the server would refuse is
 * kept as it was typed, so the section can say why it cannot be saved.
 */
export function withMinutes(setting: string, type: string, value: string): string {
    const others = setting
        .split(/[,\n]/)
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "" && entry.slice(0, entry.indexOf("=")).trim() !== type);
    const entry = value.trim();
    return [...others, ...(entry === "" ? [] : [`${type}=${entry}`])].join(", ");
}
