import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
    CreatedReportTokenSchema,
    DomainControllerListSchema,
    DomainControllerSchema,
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

/**
 * Issues the token a domain controller reports its database check with, in place of any it
 * had. The one answer that carries the token in the clear, so it is handed to the caller
 * and kept nowhere. The list is read again: it says since when a report is expected.
 */
export function useIssueReportToken() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: string) =>
            api.post(`${BASE}/${id}/report-token`, undefined, CreatedReportTokenSchema, { fallback: "Could not issue the token" }),
        onSuccess: () => client.invalidateQueries({ queryKey: domainControllerListOptions.queryKey }),
    });
}

/** Takes the token away: no database check is expected of that domain controller any more. */
export function useRevokeReportToken() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`${BASE}/${id}/report-token`, { fallback: "Could not remove the token" }),
        onSuccess: () => client.invalidateQueries({ queryKey: domainControllerListOptions.queryKey }),
    });
}
