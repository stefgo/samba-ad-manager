import { Activity, Sliders, type LucideIcon } from "lucide-react";
import { CleanupSettingsSchema } from "@sadm/shared";

import type { SettingsValues } from "../../queries/settings";

export type { SettingsValues };

export type SectionId = "tokens" | "activity";

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
        id: "tokens",
        label: "Client Tokens",
        icon: Sliders,
        keys: ["token_retention_days", "token_cleanup_interval_hours"],
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
    token_retention_days: "30",
    token_cleanup_interval_hours: "24",
    notification_retention_days: "90",
    notification_retention_count: "500",
    notification_cleanup_interval_hours: "24",
    activity_level_overrides: "",
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
