import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { DcHealthListSchema, type DcHealth } from "@sadm/shared";
import { api } from "../lib/api";
import { mergeDcHealth, type DcHealthStates } from "../lib/cacheUpdates";
import { queryClient } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";

const NO_STATES: DcHealthStates = {};

/**
 * The last measurement of every client's domain controller, by client id.
 *
 * Never stale by age: the server sends every measurement on socket connect and each new one
 * as `DC_HEALTH_UPDATE`. The request covers a slow socket, and its answer is laid over what
 * the socket has delivered meanwhile -- per client the later measurement stays.
 */
export const dcHealthStatesOptions = queryOptions({
    queryKey: queryKeys.dcHealth.states(),
    queryFn: async (): Promise<DcHealthStates> => {
        const fetched = await api.get("/api/v1/dc-health", DcHealthListSchema, {
            fallback: "Could not load the health of the domain controllers",
        });
        return mergeDcHealth(queryClient.getQueryData<DcHealthStates>(queryKeys.dcHealth.states()), fetched);
    },
    staleTime: Infinity,
});

/**
 * `isPending` until the measurements have arrived once; an empty set before that says
 * nothing. `error` is why there are none -- not a reload that failed behind what is on screen.
 */
export function useDcHealthStates() {
    const { data, isPending, error } = useQuery(dcHealthStatesOptions);
    return { states: data ?? NO_STATES, isPending, error: data === undefined ? error : null };
}

/** One client's last measurement; `undefined` while there is none. */
export function useDcHealth(clientId: string): DcHealth | undefined {
    return useQuery({
        ...dcHealthStatesOptions,
        select: (states) => states[clientId],
    }).data;
}

/**
 * Asks the agent to measure now. Not cached: the measurement arrives over the socket as
 * `DC_HEALTH_UPDATE`, and a refusal ("The agent is not connected") is the answer here.
 */
export const refreshDcHealth = (clientId: string) =>
    api.post(`/api/v1/clients/${clientId}/health/refresh`, undefined, undefined, {
        fallback: "Could not ask the agent to measure",
    });

const DbcheckResultSchema = z.object({ errors: z.number().nullable(), error: z.string().nullish() });

/** Runs the database check on the client's domain controller. Answers when it has finished. */
export const runDbcheck = (clientId: string) =>
    api.post(`/api/v1/clients/${clientId}/health/dbcheck`, undefined, DbcheckResultSchema, {
        fallback: "Could not run the database check",
    });
