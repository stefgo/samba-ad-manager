import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
    ConnectAgentSchema,
    CreatedAgentTokenSchema,
    DomainControllerListSchema,
    DomainControllerSchema,
    UpdateAgentSchema,
    type DomainController,
    type UpdateDomainController,
} from "@sadm/shared";
import { api } from "../lib/api";
import { queryClient, readUnlessPushed } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";

const NONE: DomainController[] = [];

const BASE = "/api/v1/domain-controllers";

const OkSchema = z.object({ ok: z.boolean() });

/**
 * Never stale by age: the server sends the whole list as `DOMAIN_CONTROLLERS_UPDATE`
 * whenever the directory lists another set or one of them is changed here, and again on
 * every socket connect. A list the socket wrote while the request was under way is kept
 * over the answer.
 */
export const domainControllerListOptions = queryOptions({
    queryKey: queryKeys.domainControllers.list(),
    queryFn: (): Promise<DomainController[]> =>
        readUnlessPushed(queryClient, queryKeys.domainControllers.list(), () =>
            api.get(BASE, DomainControllerListSchema, { fallback: "Could not load the domain controllers" }),
        ),
    staleTime: Infinity,
});

/**
 * The domain controllers the directory lists. `isPending` is true until the list has
 * arrived once -- by fetch or by broadcast. An empty list before that says nothing about
 * whether there is one.
 *
 * `error` is why there is no list. A reload that fails while a list is on screen leaves it
 * there, and the socket goes on keeping it current.
 */
export function useDomainControllers() {
    const { data, isPending, error } = useQuery(domainControllerListOptions);
    return { domainControllers: data ?? NONE, isPending, error: data === undefined ? error : null };
}

/** One out of the list, kept current by the socket. `undefined` while unknown. */
export function useDomainController(id: string | null | undefined): DomainController | undefined {
    return useQuery({
        ...domainControllerListOptions,
        select: (list) => list.find((dc) => dc.id === id),
    }).data;
}

/** Puts one domain controller as the server answered it into the cached list. */
const store = (updated: DomainController) =>
    queryClient.setQueryData(domainControllerListOptions.queryKey, (list) =>
        list?.map((dc) => (dc.id === updated.id ? updated : dc)),
    );

/** Sets where a domain controller is reached. The answer is the domain controller as it now stands. */
export function useUpdateDomainController() {
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: UpdateDomainController }) =>
            api.put(`${BASE}/${id}`, data, DomainControllerSchema, { fallback: "Could not save the address" }),
        onSuccess: store,
    });
}

/**
 * Asks the server to measure one domain controller now. Not cached: the measurement arrives
 * over the socket as `DC_HEALTH_UPDATE`; this answers once it has been taken.
 */
export const measureDomainController = (id: string) =>
    api.post(`${BASE}/${id}/measure`, undefined, OkSchema, { fallback: "Could not measure the domain controller" });

/** The same for every domain controller at once; answers once all have been measured. */
export const measureAllDomainControllers = () =>
    api.post(`${BASE}/measure`, undefined, OkSchema, { fallback: "Could not measure the domain controllers" });

/**
 * Issues the token an agent that dials in registers with, in place of any issued for that
 * domain controller before. The one answer that carries the token in the clear, so it is
 * handed to the caller and kept nowhere; the cached list only learns when it expires --
 * what the socket brings a moment later too, but the page shows it at once.
 */
export function useIssueAgentToken() {
    return useMutation({
        mutationFn: (id: string) =>
            api.post(`${BASE}/${id}/agent/token`, undefined, CreatedAgentTokenSchema, { fallback: "Could not issue the token" }),
        onSuccess: (created, id) =>
            queryClient.setQueryData(domainControllerListOptions.queryKey, (list) =>
                list?.map((dc) => (dc.id === id ? { ...dc, agentRegistrationExpiresAt: created.expiresAt } : dc)),
            ),
    });
}

/**
 * Has the server dial an agent and register it with its setup PIN. Answers once the agent
 * has accepted or refused; a refusal carries the agent's reason.
 */
export function useConnectAgent() {
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: z.input<typeof ConnectAgentSchema> }) =>
            api.post(`${BASE}/${id}/agent/connect`, data, DomainControllerSchema, { fallback: "Could not connect the agent" }),
        onSuccess: store,
    });
}

/**
 * Sets where the server dials an agent it reaches itself. Answers once it has been dialled
 * there, with the domain controller as it then stands.
 */
export function useUpdateAgent() {
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: z.input<typeof UpdateAgentSchema> }) =>
            api.put(`${BASE}/${id}/agent`, data, DomainControllerSchema, { fallback: "Could not save the agent's address" }),
        onSuccess: store,
    });
}

/** Takes the agent away from a domain controller, with what it reported. The list arrives over the socket. */
export function useRemoveAgent() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`${BASE}/${id}/agent`, { fallback: "Could not remove the agent" }),
        onSuccess: () => client.invalidateQueries({ queryKey: domainControllerListOptions.queryKey }),
    });
}

/**
 * Asks a domain controller's agent to run the database check now. Answers once the agent was
 * asked: the check takes minutes, and its result arrives over the socket as `DC_HEALTH_UPDATE`.
 */
export const runDbcheck = (id: string) =>
    api.post(`${BASE}/${id}/dbcheck`, undefined, OkSchema, { fallback: "Could not start the database check" });

/**
 * Asks a domain controller's agent to fix what its database check finds, and to check again.
 * Answers once the agent was asked; the check that follows arrives like any other.
 */
export const fixDbcheck = (id: string) =>
    api.post(`${BASE}/${id}/dbcheck/fix`, undefined, OkSchema, { fallback: "Could not start fixing the database" });

/**
 * Asks a domain controller's agent to replicate now from every inbound partner. Answers once
 * the agent was asked; the links are measured again when it is done, and arrive like any measurement.
 */
export const syncReplication = (id: string) =>
    api.post(`${BASE}/${id}/replication/sync`, undefined, OkSchema, { fallback: "Could not start the replication" });
