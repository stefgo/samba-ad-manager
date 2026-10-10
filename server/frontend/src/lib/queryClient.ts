import { QueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * How long an answer counts as current when nothing pushes changes to it. Long enough that
 * moving between pages does not ask again, short enough that a list nobody broadcasts --
 * users, webhooks -- is read again the next time it is opened.
 */
export const DEFAULT_STALE_MS = 30_000;

/**
 * The one cache for everything the server holds.
 *
 * A module-level instance rather than one created inside `App`: the socket handler in
 * `WebSocketProvider` writes to it outside React's render, where no hook can hand it over.
 *
 * - No refetch on window focus or on the browser's `online` event: the dashboard socket
 *   keeps the cache current.
 * - No retry: a refusal has to reach the page at once, and an expired session must never
 *   be asked again.
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: DEFAULT_STALE_MS,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: false,
        },
        mutations: {
            retry: false,
        },
    },
});

/**
 * Reads a list the socket also delivers whole, and keeps what the socket wrote meanwhile.
 *
 * A request and a push race on every page load: the server sends the client list and the
 * activity on connect, while the page asks for the same over HTTP. The stores used to let
 * whichever arrived later win, so an answer read before a change could overwrite the push
 * that reported it. Here the push wins: an entry written while the request was under way
 * is at least as new as what the request read.
 */
export async function readUnlessPushed<T>(client: QueryClient, queryKey: QueryKey, read: () => Promise<T>): Promise<T> {
    const before = client.getQueryState<T>(queryKey)?.dataUpdatedAt ?? 0;
    const fetched = await read();
    const state = client.getQueryState<T>(queryKey);
    return state && state.data !== undefined && state.dataUpdatedAt > before ? state.data : fetched;
}
