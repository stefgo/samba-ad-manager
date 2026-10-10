import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TokenListSchema } from "@sadm/shared";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

/**
 * The registration tokens. Always stale: a token is used up by a client registering with
 * it, which nothing tells the dashboard about, so the page reads the list again each time
 * it is opened.
 */
export const tokenListOptions = queryOptions({
    queryKey: queryKeys.tokens.list(),
    queryFn: () => api.get("/api/v1/tokens", TokenListSchema, { fallback: "Failed to load tokens" }),
    staleTime: 0,
});

export function useTokens() {
    return useQuery(tokenListOptions);
}

/** Deletes a token by its hash; the token itself never left the server after it was issued. */
export function useDeleteToken() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (tokenHash: string) =>
            api.delete(`/api/v1/tokens/${tokenHash}`, { fallback: "Failed to delete token" }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: tokenListOptions.queryKey }),
    });
}
