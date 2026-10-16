import { Activity, BellRing, HeartPulse, RotateCw, type LucideIcon } from "lucide-react";
import { CleanupSettingsSchema } from "@sadm/shared";

import type { SettingsValues } from "../../queries/settings";

export type { SettingsValues };

export type SectionId = "health" | "findings" | "agent-requests" | "activity";

export interface SectionDef {
    id: SectionId;
    label: string;
    icon: LucideIcon;
    /**
     * The keys this section edits, and so the keys its Save sends. The server merges what
     * arrives into the stored block, so a section never writes over another section's edits.
     */
    keys: readonly string[];
}

export const SECTIONS: readonly SectionDef[] = [
    {
        id: "health",
        label: "Domain Health",
        icon: HeartPulse,
        keys: [
            "health_max_clock_offset_seconds",
            "health_max_replication_age_minutes",
            "health_max_dbcheck_age_hours",
            "health_storage_warning_percent",
            "health_storage_error_percent",
            "health_certificate_warning_days",
            "health_certificate_error_days",
            "health_interval_seconds",
            "health_replication_interval_seconds",
        ],
    },
    {
        id: "findings",
        label: "Findings",
        icon: BellRing,
        keys: ["issue_report_after_minutes", "issue_resolve_after_minutes", "issue_report_after_overrides"],
    },
    {
        id: "agent-requests",
        label: "Agent Requests",
        icon: RotateCw,
        keys: [
            "dbcheck_fix_retries",
            "dbcheck_fix_retry_delay_minutes",
            "dbcheck_fix_timeout_minutes",
            "replication_sync_retries",
            "replication_sync_retry_delay_minutes",
            "replication_sync_timeout_minutes",
        ],
    },
    {
        id: "activity",
        label: "Activity History",
        icon: Activity,
        keys: [
            "notification_retention_days",
            "notification_retention_count",
            "notification_cleanup_interval_hours",
            "activity_level_overrides",
        ],
    },
];

export const SECTION_IDS: readonly SectionId[] = SECTIONS.map((s) => s.id);

/** What a section shows until the server has answered -- the server's own defaults. */
export const DEFAULT_SETTINGS: SettingsValues = {
    notification_retention_days: "90",
    notification_retention_count: "500",
    notification_cleanup_interval_hours: "24",
    activity_level_overrides: "",
    health_max_clock_offset_seconds: "300",
    health_max_replication_age_minutes: "60",
    health_max_dbcheck_age_hours: "36",
    health_storage_warning_percent: "15",
    health_storage_error_percent: "5",
    health_certificate_warning_days: "14",
    health_certificate_error_days: "3",
    health_interval_seconds: "60",
    health_replication_interval_seconds: "300",
    issue_report_after_minutes: "5",
    issue_resolve_after_minutes: "5",
    issue_report_after_overrides: "",
    dbcheck_fix_retries: "2",
    dbcheck_fix_retry_delay_minutes: "10",
    dbcheck_fix_timeout_minutes: "360",
    replication_sync_retries: "2",
    replication_sync_retry_delay_minutes: "2",
    replication_sync_timeout_minutes: "30",
};

/** Whether the draft differs from what the server holds in any of the section's keys. */
export const isDirty = (section: SectionDef, draft: SettingsValues, saved: SettingsValues): boolean =>
    section.keys.some((key) => (draft[key] ?? "") !== (saved[key] ?? ""));

/** What a section's Save sends: its own keys, as the fields show them. */
export const sectionBody = (section: SectionDef, draft: SettingsValues): SettingsValues =>
    Object.fromEntries(section.keys.map((key) => [key, draft[key] ?? ""]));

/**
 * What the server would refuse about a section, or `null`. Checked against the schema the
 * endpoint parses the request with, so the reason is on the page before anything is sent.
 */
export function sectionError(section: SectionDef, draft: SettingsValues): string | null {
    const parsed = CleanupSettingsSchema.safeParse(sectionBody(section, draft));
    if (parsed.success) return null;
    const issue = parsed.error.issues[0];
    const key = issue.path.join(".");
    return key ? `${key}: ${issue.message}` : issue.message;
}

/** Props every section component takes: its values, and a way to change one of them. */
export interface SectionProps {
    values: SettingsValues;
    onChange: (key: string, value: string) => void;
}
