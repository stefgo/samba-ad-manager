import { queryOptions, useQuery } from "@tanstack/react-query";
import { SchedulerStatusResponseSchema, type SchedulerId, type SchedulerStatuses } from "@sadm/shared";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

/**
 * The schedulers the server itself runs: the maintenance jobs on the settings page.
 *
 * Read once and kept current by `SCHEDULER_STATUS_UPDATE`, which carries one scheduler at
 * a time -- so the entry is never stale by age. Saving the settings invalidates it: a
 * changed interval moves the next scheduled run.
 */
export const schedulerStatusOptions = queryOptions({
    queryKey: queryKeys.settings.schedulerStatus(),
    queryFn: async (): Promise<SchedulerStatuses> =>
        (
            await api.get("/api/v1/settings/scheduler-status", SchedulerStatusResponseSchema, {
                fallback: "Could not load the scheduler status",
            })
        ).schedulers,
    staleTime: Infinity,
});

/** One scheduler's status; `undefined` until it has been read. */
export function useSchedulerStatus<Id extends SchedulerId>(scheduler: Id): SchedulerStatuses[Id] | undefined {
    return useQuery({
        ...schedulerStatusOptions,
        select: (schedulers) => schedulers[scheduler],
    }).data;
}
