import { FieldLabel, Input, NumberField, SectionHeader, Select } from "@stefgo/react-ui-components";
import { runCleanup } from "../../../queries/settings";
import type { SectionProps } from "../sections";
import { EVENT_LEVEL_GROUPS, choiceOf, levelChoices, withChoice } from "../lib/eventLevels";
import { ISSUE_KINDS, minutesOf, withMinutes } from "../lib/issueTiming";
import { SchedulerBox } from "./SchedulerBox";
import { ManualRun } from "./SettingsParts";

export const HealthSection = ({ values, onChange }: SectionProps) => (
    <section>
        <SectionHeader title="Domain Health">
            From when on a measurement counts as a finding. A finding shows on the dashboard at once; when the
            activity and the webhooks hear of it is set under Findings.
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
            <NumberField
                label="Database Check Age (Hours)"
                value={values.health_max_dbcheck_age_hours}
                onChange={(v) => onChange("health_max_dbcheck_age_hours", v)}
                min={1}
                placeholder="36"
                hint="How old the last database check of a domain controller may be. Only for those whose agent runs one."
            />
            <NumberField
                label="Storage Warning (Percent Free)"
                value={values.health_storage_warning_percent}
                onChange={(v) => onChange("health_storage_warning_percent", v)}
                min={1}
                placeholder="15"
                hint="Below how much free space the storage of a domain controller is a warning. Read by its agent."
            />
            <NumberField
                label="Storage Error (Percent Free)"
                value={values.health_storage_error_percent}
                onChange={(v) => onChange("health_storage_error_percent", v)}
                min={1}
                placeholder="5"
                hint="Below how much it is an error: a full volume damages the directory's database."
            />
        </div>

        <div className="mt-10">
            <SectionHeader title="Measuring">
                How often the domain controllers are measured. A change applies from the next round on.
            </SectionHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <NumberField
                    label="Measurement Interval (Seconds)"
                    value={values.health_interval_seconds}
                    onChange={(v) => onChange("health_interval_seconds", v)}
                    min={10}
                    placeholder="60"
                    hint="How often every domain controller is measured: its services, its clock, how it sees the domain."
                />
                <NumberField
                    label="Replication Interval (Seconds)"
                    value={values.health_replication_interval_seconds}
                    onChange={(v) => onChange("health_replication_interval_seconds", v)}
                    min={30}
                    placeholder="300"
                    hint="How often replication, the object counts and the DNS zones are read, and the name servers that are no domain controllers asked."
                />
            </div>
        </div>
    </section>
);

export const FindingsSection = ({ values, onChange }: SectionProps) => (
    <section>
        <SectionHeader title="Findings">
            When the activity and the webhooks hear of a finding. The dashboard shows a finding at once and says
            when it will be reported; a finding that does not last as long is never reported. A finding that comes
            and goes counts as one as long as it is never gone for longer than the wait before the all-clear.
        </SectionHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <NumberField
                label="Report After (Minutes)"
                value={values.issue_report_after_minutes}
                onChange={(v) => onChange("issue_report_after_minutes", v)}
                min={0}
                placeholder="5"
                hint="How long a finding has to last before it is reported, and a warning has to be an error before that is reported. 0 reports it at once."
            />
            <NumberField
                label="All-Clear After (Minutes)"
                value={values.issue_resolve_after_minutes}
                onChange={(v) => onChange("issue_resolve_after_minutes", v)}
                min={0}
                placeholder="5"
                hint="How long a reported finding has to be gone before it is called off."
            />
        </div>

        <div className="mt-10">
            <SectionHeader title="Per Kind of Finding">
                A wait of its own for a kind of finding, in minutes, in place of Report After. Empty uses Report After.
            </SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                {/* Not a NumberField: that turns an empty field into its minimum, and empty is what
                    takes a kind back to Report After. What the server refuses, the section says. */}
                {ISSUE_KINDS.map(({ type, label }) => (
                    <Input
                        key={type}
                        label={label}
                        inputMode="numeric"
                        value={minutesOf(values.issue_report_after_overrides, type)}
                        onChange={(e) =>
                            onChange("issue_report_after_overrides", withMinutes(values.issue_report_after_overrides, type, e.target.value))
                        }
                        placeholder={values.issue_report_after_minutes || "5"}
                    />
                ))}
            </div>
        </div>
    </section>
);

/** The fields of one operation an agent tries again. */
const RetryFields = ({
    prefix,
    values,
    onChange,
    defaults,
}: SectionProps & { prefix: "dbcheck_fix" | "replication_sync"; defaults: { retries: string; delay: string; timeout: string } }) => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <NumberField
            label="Retries"
            value={values[`${prefix}_retries`]}
            onChange={(v) => onChange(`${prefix}_retries`, v)}
            min={0}
            placeholder={defaults.retries}
            hint="How often it is tried again after the first attempt, at most 10. 0 tries once."
        />
        <NumberField
            label="Retry After (Minutes)"
            value={values[`${prefix}_retry_delay_minutes`]}
            onChange={(v) => onChange(`${prefix}_retry_delay_minutes`, v)}
            min={1}
            placeholder={defaults.delay}
            hint="How long the agent waits after an attempt before the next."
        />
        <NumberField
            label="Outcome Expected Within (Minutes)"
            value={values[`${prefix}_timeout_minutes`]}
            onChange={(v) => onChange(`${prefix}_timeout_minutes`, v)}
            min={1}
            placeholder={defaults.timeout}
            hint="Every attempt included. Without an outcome by then, the activity says so; one that arrives later still counts."
        />
    </div>
);

export const AgentRequestsSection = ({ values, onChange }: SectionProps) => (
    <section>
        <SectionHeader title="Agent Requests">
            What a domain controller's agent is asked to do from its page is tried again while it does not succeed. Each
            attempt is a step of one row in the activity, and only the outcome is reported to the webhooks. A change applies
            to the next request; the agent of an older image tries once.
        </SectionHeader>

        <FieldLabel>Fix errors</FieldLabel>
        <p className="text-xs text-text-muted mb-3">Tried again while the fix fails or errors are left. Every attempt holds back writes to the database while it runs.</p>
        <RetryFields prefix="dbcheck_fix" values={values} onChange={onChange} defaults={{ retries: "2", delay: "10", timeout: "360" }} />

        <div className="mt-10">
            <FieldLabel>Replicate now</FieldLabel>
            <p className="text-xs text-text-muted mb-3">Tried again while a link fails, or while there is no inbound link although there are partners.</p>
            <RetryFields prefix="replication_sync" values={values} onChange={onChange} defaults={{ retries: "2", delay: "2", timeout: "30" }} />
        </div>
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
