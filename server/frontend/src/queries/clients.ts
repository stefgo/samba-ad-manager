import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    ClientListSchema,
    CreatedTokenSchema,
    type Client,
    type CreateOutboundClient,
    type UpdateClient,
} from "@sadm/shared";
import { api } from "../lib/api";
import { queryClient, readUnlessPushed } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";

const NO_CLIENTS: Client[] = [];

/**
 * Never stale by age: the server sends the whole list as `CLIENTS_UPDATE` whenever a
 * client connects, drops or changes, and again on every socket connect. A list the socket
 * wrote while the request was under way is kept over the answer.
 */
export const clientListOptions = queryOptions({
    queryKey: queryKeys.clients.list(),
    queryFn: (): Promise<Client[]> =>
        readUnlessPushed(queryClient, queryKeys.clients.list(), () =>
            api.get("/api/v1/clients", ClientListSchema, { fallback: "Failed to fetch clients" }),
        ),
    staleTime: Infinity,
});

/**
 * The registered clients. `isPending` is true until the list has arrived once -- by fetch
 * or by broadcast. An empty list before that says nothing about whether a client exists.
 *
 * `error` is why there is no list. A reload that fails while a list is on screen leaves it
 * there, and the socket goes on keeping it current.
 */
export function useClients() {
    const { data, isPending, error, refetch } = useQuery(clientListOptions);
    return { clients: data ?? NO_CLIENTS, isPending, error: data === undefined ? error : null, refetch };
}

/** One client out of the list, kept current by the socket. `undefined` while unknown. */
export function useClient(clientId: string | null | undefined): Client | undefined {
    return useQuery({
        ...clientListOptions,
        select: (clients) => clients.find((c) => c.id === clientId),
    }).data;
}

/**
 * Both mutations below change the list at once and put the previous one back when the
 * server refuses. A fetch still in flight is cancelled first: its answer was read before
 * the change and would otherwise overwrite it.
 */
function useOptimisticClientList<TVariables>(
    mutationFn: (variables: TVariables) => Promise<void>,
    apply: (clients: Client[], variables: TVariables) => Client[],
) {
    const queryClient = useQueryClient();
    const key = clientListOptions.queryKey;
    return useMutation({
        mutationFn,
        onMutate: async (variables: TVariables) => {
            await queryClient.cancelQueries({ queryKey: key });
            const previous = queryClient.getQueryData(key);
            queryClient.setQueryData(key, (clients) => clients && apply(clients, variables));
            return { previous };
        },
        onError: (_error, _variables, context) => {
            if (context?.previous) queryClient.setQueryData(key, context.previous);
        },
    });
}

export function useUpdateClient() {
    return useOptimisticClientList(
        ({ clientId, data }: { clientId: string; data: UpdateClient }) =>
            api.put(`/api/v1/clients/${clientId}`, data, undefined, { fallback: "Failed to update client" }),
        (clients, { clientId, data }) => clients.map((c) => (c.id === clientId ? { ...c, ...data } : c)),
    );
}

export function useDeleteClient() {
    return useOptimisticClientList(
        (clientId: string) => api.delete(`/api/v1/clients/${clientId}`, { fallback: "Failed to delete client" }),
        (clients, clientId) => clients.filter((c) => c.id !== clientId),
    );
}

/**
 * Registers an outbound client: the server dials the agent, and answers only once that
 * connection stands or has failed -- so a refusal carries the agent's own reason. The list
 * is read again afterwards; the server broadcasts it too, which a socket that is down
 * would miss.
 */
export function useCreateOutboundClient() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateOutboundClient) =>
            api.post("/api/v1/clients/outbound", data, undefined, { fallback: "Failed to create outbound client" }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: clientListOptions.queryKey }),
    });
}

/**
 * Asks the server to dial an outbound client again. Not cached: a connection is tried now
 * or not at all, and whether it stands arrives as `CLIENTS_UPDATE`.
 */
export const reconnectClient = (clientId: string) =>
    api.post(`/api/v1/clients/${clientId}/reconnect`, undefined, undefined, {
        fallback: "The server could not be asked to reconnect",
    });

/**
 * Issues a registration token for an inbound client. The one answer that carries the token
 * in the clear, so it is handed to the caller and kept nowhere.
 */
export const createClientToken = (input: { displayName?: string; inboundAllowedIp?: string }) =>
    api.post("/api/v1/tokens", input, CreatedTokenSchema, { fallback: "Failed to create token" });
