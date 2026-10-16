import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
    DcHealthListSchema,
    DnsServerHealthListSchema,
    DomainIssueStateListSchema,
    ServiceUrlHealthListSchema,
    type DcHealth,
    type DnsServerHealth,
    type DomainIssueState,
    type ServiceUrlHealth,
} from "@sadm/shared";
import { api } from "../lib/api";
import { mergeDcHealth, type DcHealthStates } from "../lib/cacheUpdates";
import { queryClient } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";

const NO_STATES: DcHealthStates = {};

/**
 * What is known of the health of every domain controller, by its id.
 *
 * Never stale by age: the server sends all of it on socket connect and each change as
 * `DC_HEALTH_UPDATE`. The request covers a slow socket, and its answer is laid over what
 * the socket has delivered meanwhile -- per domain controller the later one stays.
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

/** What is known of one domain controller; `undefined` before its first measurement. */
export function useDcHealth(dcId: string): DcHealth | undefined {
    return useQuery({
        ...dcHealthStatesOptions,
        select: (states) => states[dcId],
    }).data;
}

const NO_NAME_SERVERS: DnsServerHealth[] = [];

/**
 * The name servers of the domain that are no domain controllers, as the server last asked
 * them. Like the measurements never stale by age: the server sends the whole list on socket
 * connect and again whenever it has asked.
 */
export const nameServersOptions = queryOptions({
    queryKey: queryKeys.dcHealth.nameServers(),
    queryFn: () =>
        api.get("/api/v1/dc-health/name-servers", DnsServerHealthListSchema, { fallback: "Could not load the name servers" }),
    staleTime: Infinity,
});

export const useNameServers = (): DnsServerHealth[] => useQuery(nameServersOptions).data ?? NO_NAME_SERVERS;

const NO_SERVICE_URLS: ServiceUrlHealth[] = [];

/**
 * The names applications reach the directory under (`directory.serviceUrls`), as the server
 * last asked them. Never stale by age: the server sends the whole list on socket connect and
 * again whenever it has asked.
 */
export const serviceUrlsOptions = queryOptions({
    queryKey: queryKeys.dcHealth.serviceUrls(),
    queryFn: () =>
        api.get("/api/v1/dc-health/service-urls", ServiceUrlHealthListSchema, { fallback: "Could not load the central URLs" }),
    staleTime: Infinity,
});

export const useServiceUrls = (): ServiceUrlHealth[] => useQuery(serviceUrlsOptions).data ?? NO_SERVICE_URLS;

const NO_ISSUE_STATES: ReadonlyMap<string, DomainIssueState> = new Map();

/**
 * Where every finding stands with the activity: waiting to be reported, or reported. The
 * findings themselves the dashboard derives; this only says when the activity hears of one.
 * Like the measurements never stale by age: the server sends it whole on socket connect and
 * again whenever it changed.
 */
export const issueStatesOptions = queryOptions({
    queryKey: queryKeys.dcHealth.issues(),
    queryFn: () => api.get("/api/v1/dc-health/issues", DomainIssueStateListSchema, { fallback: "Could not load the findings" }),
    staleTime: Infinity,
});

/** The state of every tracked finding, by `DomainIssue.id`. */
export const useIssueStates = (): ReadonlyMap<string, DomainIssueState> =>
    useQuery({ ...issueStatesOptions, select: (states) => new Map(states.map((state) => [state.id, state])) }).data ??
    NO_ISSUE_STATES;

const DomainHealthOptionsSchema = z.object({
    maxClockOffsetSeconds: z.number(),
    maxReplicationAgeMinutes: z.number(),
    maxDbcheckAgeHours: z.number(),
    storageWarningPercent: z.number(),
    storageErrorPercent: z.number(),
    certificateWarningDays: z.number(),
    certificateErrorDays: z.number(),
});

/**
 * The thresholds the server judges the findings by, so the dashboard judges by the same.
 * They are settings: read again after the settings page saved, and `undefined` until then,
 * which `buildDomainHealth` reads as its defaults -- the server's own.
 */
export const domainHealthOptionsQuery = queryOptions({
    queryKey: queryKeys.dcHealth.options(),
    queryFn: () =>
        api.get("/api/v1/dc-health/options", DomainHealthOptionsSchema, { fallback: "Could not load the health thresholds" }),
    staleTime: 5 * 60_000,
});
