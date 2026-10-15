/**
 * When a finding becomes an event: how long it has to last before it is reported, per kind
 * of finding, and how long it has to be gone before the all-clear. The dashboard shows a
 * finding at once; these say when the activity and the webhooks hear of it.
 */

/** The longest wait a setting may ask for: a day. */
export const MAX_ISSUE_WAIT_MINUTES = 1440;

export const DEFAULT_ISSUE_REPORT_AFTER_MINUTES = 5;
export const DEFAULT_ISSUE_RESOLVE_AFTER_MINUTES = 5;

/** Kind of finding to minutes. A map, because a setting may name a kind this build does not know. */
export type IssueTimingOverrides = ReadonlyMap<string, number>;

/**
 * Reads the `issue_report_after_overrides` setting: `kind=minutes` entries separated by
 * commas or line breaks, e.g. `replication-failing=15, dc-unreachable=2`.
 *
 * The kind is not checked against `DOMAIN_ISSUE_TYPES`: a setting written for another
 * version may name one this build does not know, and it is carried along all the same.
 * `error` is the first entry that cannot be read; the entries that can are returned next to it.
 */
export function parseIssueTimingOverrides(text: string): { overrides: Map<string, number>; error: string | null } {
    const overrides = new Map<string, number>();
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
            fail(`"${entry}" is not of the form kind=minutes`);
        } else if (!/^\d+$/.test(value) || Number(value) > MAX_ISSUE_WAIT_MINUTES) {
            fail(`${kind}: Must be a whole number of minutes from 0 to ${MAX_ISSUE_WAIT_MINUTES}`);
        } else if (overrides.has(kind)) {
            fail(`${kind}: Given more than once`);
        } else {
            overrides.set(kind, Number(value));
        }
    }
    return { overrides, error };
}

/** The setting as it is stored, in the order the entries were made. */
export const formatIssueTimingOverrides = (overrides: IssueTimingOverrides): string =>
    [...overrides].map(([kind, minutes]) => `${kind}=${minutes}`).join(", ");

/** The waits a finding is judged by, in milliseconds. */
export interface IssueTiming {
    /** How long a finding of this kind has to last before it is reported, and before it is reported as worse. */
    reportAfterMs: (type: string) => number;
    /** How long a finding has to be gone before it is called off, or forgotten before it was reported. */
    resolveAfterMs: number;
}

const minutesOf = (value: unknown, fallback: number): number => {
    const text = String(value ?? "").trim();
    if (!/^\d+$/.test(text)) return fallback;
    return Math.min(Number(text), MAX_ISSUE_WAIT_MINUTES);
};

/** The waits as the settings block holds them, with the defaults for what is missing or no number. */
export function issueTimingFromSettings(settings: Readonly<Record<string, unknown>>): IssueTiming {
    const reportAfter = minutesOf(settings.issue_report_after_minutes, DEFAULT_ISSUE_REPORT_AFTER_MINUTES);
    const resolveAfter = minutesOf(settings.issue_resolve_after_minutes, DEFAULT_ISSUE_RESOLVE_AFTER_MINUTES);
    const { overrides } = parseIssueTimingOverrides(String(settings.issue_report_after_overrides ?? ""));
    return {
        reportAfterMs: (type) => (overrides.get(type) ?? reportAfter) * 60_000,
        resolveAfterMs: resolveAfter * 60_000,
    };
}
