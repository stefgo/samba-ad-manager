import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WebhookListSchema, WebhookTestResultSchema, type Webhook, type WebhookInput } from "@sadm/shared";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

const NO_WEBHOOKS: Webhook[] = [];

/**
 * The webhooks events are reported to, with how their last delivery went.
 *
 * Nothing broadcasts a change to them, so the list goes stale by age and is read again by
 * whatever opens it after that -- and at once after a change made here.
 */
export const webhookListOptions = queryOptions({
    queryKey: queryKeys.webhooks.list(),
    queryFn: () => api.get("/api/v1/webhooks", WebhookListSchema, { fallback: "Failed to fetch webhooks" }),
});

/**
 * `isPending` until the list has arrived once; an empty list before that says nothing.
 * `error` is why there is no list.
 */
export function useWebhooks() {
    const { data, isPending, error } = useQuery(webhookListOptions);
    return { webhooks: data ?? NO_WEBHOOKS, isPending, error: data === undefined ? error : null };
}

/** Creates a webhook, or changes the one `id` names. PUT takes the whole webhook. */
export function useSaveWebhook() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, input }: { id?: string; input: WebhookInput }) =>
            id ? api.put(`/api/v1/webhooks/${id}`, input) : api.post("/api/v1/webhooks", input),
        // Also after a refusal: the list then shows what the server holds, which puts a
        // switch that had already moved back where it was.
        onSettled: () => queryClient.invalidateQueries({ queryKey: webhookListOptions.queryKey }),
    });
}

export function useDeleteWebhook() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/webhooks/${id}`, { fallback: "Failed to delete the webhook" }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: webhookListOptions.queryKey }),
    });
}

/**
 * Delivers the sample event with the webhook as it stands in the editor, saved or not.
 * Not cached: a delivery is made now or not at all.
 */
export const testWebhook = (input: WebhookInput) =>
    api.post("/api/v1/webhooks/test", input, WebhookTestResultSchema);
