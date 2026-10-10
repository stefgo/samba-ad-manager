import type { SchedulerId, SchedulerRunSummary } from "@sadm/shared";

/**
 * What a scheduler's last run did, as the settings page words it. The server stores the
 * numbers; the sentence is written here, like the activity texts.
 */
export function describeRunResult<Id extends SchedulerId>(id: Id, run: SchedulerRunSummary<Id>): string {
    if (run.status === "failed" || run.status === "interrupted") {
        return run.error ?? (run.status === "failed" ? "Failed" : "Interrupted");
    }
    const result = run.result as SchedulerRunSummary["result"];
    if (!result) return "Done";
    switch (id) {
        // Every scheduler here reports how many rows it removed.
        default:
            return `${result.removed} removed`;
    }
}
