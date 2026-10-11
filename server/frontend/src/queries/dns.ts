import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { DnsZoneDetailSchema, DnsZoneSchema, type CreateDnsRecord, type DeleteDnsRecord, type UpdateDnsRecord } from "@sadm/shared";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

/**
 * The DNS zones, as the server reads them out of the directory on every request. Like the
 * rest of the directory nothing pushes a change to them -- a client that registers itself
 * changes a zone without anybody here doing a thing -- so what is cached goes stale by age.
 */
const STALE_MS = 30_000;

const BASE = "/api/v1/dns";

export const dnsZonesOptions = queryOptions({
    queryKey: queryKeys.directory.dnsZones(),
    queryFn: () => api.get(`${BASE}/zones`, z.array(DnsZoneSchema), { fallback: "Could not load the zones" }),
    staleTime: STALE_MS,
});

export const useDnsZones = () => useQuery(dnsZonesOptions);

/** One zone with its names and records. A 404 is an answer -- the zone is gone -- and not retried. */
export function useDnsZone(guid: string) {
    return useQuery({
        queryKey: queryKeys.directory.dnsZone(guid),
        queryFn: () => api.get(`${BASE}/zones/${guid}`, DnsZoneDetailSchema, { fallback: "Could not load the zone" }),
        staleTime: STALE_MS,
        retry: false,
    });
}

/**
 * Every change to a zone's records. Each is a plain request; `useDirectoryChange` wraps one
 * so that the zones are read again once it went through -- they are part of the directory.
 */
export const dnsApi = {
    createRecord: (zoneGuid: string, input: CreateDnsRecord) =>
        api.post(`${BASE}/zones/${zoneGuid}/records`, input, undefined, { fallback: "Could not create the record" }),
    updateRecord: (zoneGuid: string, nodeGuid: string, input: UpdateDnsRecord) =>
        api.put(`${BASE}/zones/${zoneGuid}/nodes/${nodeGuid}/records`, input, undefined, { fallback: "Could not save the record" }),
    deleteRecord: (zoneGuid: string, nodeGuid: string, input: DeleteDnsRecord) =>
        api.post(`${BASE}/zones/${zoneGuid}/nodes/${nodeGuid}/records/delete`, input, undefined, {
            fallback: "Could not delete the record",
        }),
};
