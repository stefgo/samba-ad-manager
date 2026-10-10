import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityListSchema, type ActivityRecord } from "@sadm/shared";
import { api } from "../lib/api";
import { markActivitySeen, unmarkActivitySeen, unseenAmong, unseenTone, type UnseenTone } from "../lib/cacheUpdates";
import { queryClient, readUnlessPushed } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";

const NO_EVENTS: ActivityRecord[] = [];

/**
 * What happened on the hosts and in the control plane, as the server reads it for this
 * session's user: `seen` is theirs.
 *
 * Never stale by age. The whole list arrives as `ACTIVITY_UPDATE` on every socket connect,
 * new events as `ACTIVITY_APPENDED`, and what this user marked seen elsewhere as
 * `ACTIVITY_SEEN`. A list the socket wrote while the request was under way is kept over
 * the answer.
 */
export const activityListOptions = queryOptions({
    queryKey: queryKeys.activity.list(),
    queryFn: (): Promise<ActivityRecord[]> =>
        readUnlessPushed(queryClient, queryKeys.activity.list(), () =>
            api.get("/api/v1/activity", ActivityListSchema, { fallback: "Could not load the activity" }),
        ),
    staleTime: Infinity,
});

/**
 * The events, newest first. `isPending` until the list has arrived once; `error` is why
 * there is no list.
 */
export function useActivity() {
    const { data, isPending, error } = useQuery(activityListOptions);
    return { events: data ?? NO_EVENTS, isPending, error: data === undefined ? error : null };
}

/** What the sidebar badge shows. A string, so the shell re-renders only when it changes. */
export function useUnseenTone(): UnseenTone {
    return useQuery({ ...activityListOptions, select: unseenTone }).data ?? null;
}

/**
 * One request for many events. The server answers the sessions of this user with
 * `ACTIVITY_SEEN`, and nobody else.
 *
 * Optimistic: the rows turn seen at once. If the request fails, exactly the events this
 * call turned seen go back -- the server sent nothing, so without the rollback the list
 * would claim a state the server does not have until the next load.
 */
export function useMarkActivitySeen() {
    const queryClient = useQueryClient();
    const key = activityListOptions.queryKey;
    return useMutation({
        mutationFn: (ids: string[]) =>
            api.post("/api/v1/activity/seen", { ids }, undefined, { fallback: "Failed to mark the events as seen" }),
        onMutate: async (ids: string[]) => {
            await queryClient.cancelQueries({ queryKey: key });
            const marked = unseenAmong(queryClient.getQueryData(key) ?? NO_EVENTS, ids);
            queryClient.setQueryData(key, (events) => events && markActivitySeen(events, ids));
            return { marked };
        },
        onError: (_error, _ids, context) => {
            if (!context) return;
            queryClient.setQueryData(key, (events) => events && unmarkActivitySeen(events, context.marked));
        },
    });
}

/**
 * Deletes the whole log. The list empties at once and comes back if the server refuses;
 * every other dashboard learns of it through `ACTIVITY_UPDATE`.
 */
export function useClearActivity() {
    const queryClient = useQueryClient();
    const key = activityListOptions.queryKey;
    return useMutation({
        mutationFn: () => api.delete("/api/v1/activity", { fallback: "Failed to delete the activity log" }),
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: key });
            const previous = queryClient.getQueryData(key);
            queryClient.setQueryData(key, (events) => events && []);
            return { previous };
        },
        onError: (_error, _variables, context) => {
            if (context?.previous) queryClient.setQueryData(key, context.previous);
        },
    });
}
