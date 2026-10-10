import { FieldLabel, NumberField, SectionHeader, Select } from "@stefgo/react-ui-components";
import { runCleanup } from "../../../queries/settings";
import type { SectionProps } from "../sections";
import { EVENT_LEVEL_GROUPS, choiceOf, levelChoices, withChoice } from "../lib/eventLevels";
import { SchedulerBox } from "./SchedulerBox";
import { ManualRun } from "./SettingsParts";

export const HealthSection = ({ values, onChange }: SectionProps) => (
    <section>
        <SectionHeader title="Domain Health">
            From when on a measurement counts as a finding. A finding shows on the dashboard at once, and is
            reported to the activity and the webhooks once it has lasted three quarters of a minute.
        </SectionHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <NumberField
                label="Clock Offset (Seconds)"
                value={values.health_max_clock_offset_seconds}
                onChange={(v) => onChange("health_max_clock_offset_seconds", v)}
                min={1}
                placeholder="300"
                hint="How far a domain controller's clock may be from this server's. Kerberos refuses logons at 300."
            />
            <NumberField
                label="Replication Age (Minutes)"
                value={values.health_max_replication_age_minutes}
                onChange={(v) => onChange("health_max_replication_age_minutes", v)}
                min={1}
                placeholder="60"
                hint="How old the last successful replication from a partner may be."
            />
        </div>
    </section>
);

export const TokenRetentionSection = ({ values, onChange }: SectionProps) => (
    <section>
        <SectionHeader title="Retention of invalid registration tokens">
            Define how long registration tokens are kept after they become invalid. A scheduled
            cleanup removes the ones older than that.
        </SectionHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <NumberField
                label="Retention Time (Days)"
                value={values.token_retention_days}
                onChange={(v) => onChange("token_retention_days", v)}
                placeholder="30"
                hint="Number of days an invalid token remains in the database."
            />
            <NumberField
                label="Cleanup Interval (Hours)"
                value={values.token_cleanup_interval_hours}
                onChange={(v) => onChange("token_cleanup_interval_hours", v)}
                placeholder="24"
                hint="How often the automatic cleanup runs. Set to 0 to disable the scheduler (manual runs still work)."
            />
        </div>

        <SchedulerBox scheduler="token-cleanup">
            <ManualRun
                description="Trigger the maintenance process immediately using the saved retention settings."
                failureTitle="Could not remove the invalid tokens"
                onRun={async () => {
                    const data = await runCleanup("invalid-tokens");
                    return typeof data.removed === "number" ? `Removed ${data.removed}` : "Done";
                }}
            />
        </SchedulerBox>
    </section>
);

export const ActivitySection = ({ values, onChange }: SectionProps) => (
    <section>
        <SectionHeader title="Activity History">
            Controls how long activity events are kept in the database. Old entries are removed
            automatically while always preserving a minimum number of the most recent events.
        </SectionHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <NumberField
                label="Retention Time (Days)"
                value={values.notification_retention_days}
                onChange={(v) => onChange("notification_retention_days", v)}
                min={1}
                placeholder="90"
                hint="Events older than this are eligible for removal."
            />
            <NumberField
                label="Minimum Keep Count"
                value={values.notification_retention_count}
                onChange={(v) => onChange("notification_retention_count", v)}
                placeholder="500"
                hint="Always keep at least this many of the most recent events, regardless of age."
            />
            <NumberField
                label="Cleanup Interval (Hours)"
                value={values.notification_cleanup_interval_hours}
                onChange={(v) => onChange("notification_cleanup_interval_hours", v)}
                placeholder="24"
                hint="How often the automatic cleanup runs. Set to 0 to disable the scheduler (manual runs still work)."
            />
        </div>

        <SchedulerBox scheduler="notification-cleanup">
            <ManualRun
                description="Immediately remove activity events that exceed the saved retention settings."
                failureTitle="Could not clean up the activity history"
                onRun={async () => {
                    const data = await runCleanup("notifications");
                    return typeof data.removed === "number" ? `Removed ${data.removed}` : "Done";
                }}
            />
        </SchedulerBox>

        <div className="mt-10">
            <SectionHeader title="Event Levels">
                Sets the level an event is recorded with, per kind of event. Applies to events from
                now on: the list, the badges and the minimum level of a webhook all read it, and what
                is already in the history stays as it is. <code className="font-sans">none</code> keeps
                a kind out of the history altogether, and no webhook is sent for it.
            </SectionHeader>

            <div className="space-y-6">
                {EVENT_LEVEL_GROUPS.map((group) => (
                    <div key={group.label}>
                        <FieldLabel>{group.label}</FieldLabel>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                            {group.kinds.map((kind) => (
                                <div key={kind} className="min-w-0">
                                    <div className="font-mono text-xs text-text-muted mb-1 truncate">{kind}</div>
                                    <Select
                                        aria-label={`Level of ${kind}`}
                                        value={choiceOf(values.activity_level_overrides, kind)}
                                        onChange={(e) =>
                                            onChange(
                                                "activity_level_overrides",
                                                withChoice(values.activity_level_overrides, kind, e.target.value),
                                            )
                                        }
                                        options={levelChoices(kind)}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    </section>
);
