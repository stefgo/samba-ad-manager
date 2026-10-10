import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
    DirectoryComputerSchema,
    DirectoryContainerSchema,
    DirectoryGroupSchema,
    DirectoryRefSchema,
    DirectoryUserSchema,
    type CreateDirectoryUser,
    type CreateGroup,
    type CreateOu,
    type SetPassword,
    type UpdateComputer,
    type UpdateDirectoryUser,
    type UpdateGroup,
    type UpdateOu,
} from "@sadm/shared";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

/**
 * The directory, as the server reads it from a domain controller on every request. Nothing
 * pushes a change -- another administrator's tool may have made it -- so what is cached goes
 * stale by age and is read again by whatever shows it after that, and at once after a
 * change made here.
 */
const STALE_MS = 30_000;

const BASE = "/api/v1/directory";

const DirectoryStatusSchema = z.object({
    available: z.boolean(),
    writable: z.boolean(),
    via: z.object({ clientId: z.string(), name: z.string() }).nullable(),
});

const CreatedSchema = z.object({ guid: z.string() });

const TreeSchema = z.object({ baseDn: z.string(), containers: z.array(DirectoryContainerSchema) });

/** Whether the directory can be read and changed right now, and through which domain controller. */
export function useDirectoryStatus() {
    return useQuery({
        queryKey: queryKeys.directory.status(),
        queryFn: () => api.get(`${BASE}/status`, DirectoryStatusSchema, { fallback: "Could not ask for the directory" }),
        // The agents come and go: asked again whenever a page of the directory is opened.
        staleTime: 5000,
    });
}

export const directoryUsersOptions = queryOptions({
    queryKey: queryKeys.directory.users(),
    queryFn: () => api.get(`${BASE}/users`, z.array(DirectoryUserSchema), { fallback: "Could not load the users" }),
    staleTime: STALE_MS,
});

export const directoryGroupsOptions = queryOptions({
    queryKey: queryKeys.directory.groups(),
    queryFn: () => api.get(`${BASE}/groups`, z.array(DirectoryGroupSchema), { fallback: "Could not load the groups" }),
    staleTime: STALE_MS,
});

export const directoryComputersOptions = queryOptions({
    queryKey: queryKeys.directory.computers(),
    queryFn: () =>
        api.get(`${BASE}/computers`, z.array(DirectoryComputerSchema), { fallback: "Could not load the computers" }),
    staleTime: STALE_MS,
});

export const directoryTreeOptions = queryOptions({
    queryKey: queryKeys.directory.tree(),
    queryFn: () => api.get(`${BASE}/tree`, TreeSchema, { fallback: "Could not load the organizational units" }),
    staleTime: STALE_MS,
});

export const useDirectoryUsers = () => useQuery(directoryUsersOptions);
export const useDirectoryGroups = () => useQuery(directoryGroupsOptions);
export const useDirectoryComputers = () => useQuery(directoryComputersOptions);
export const useDirectoryTree = () => useQuery(directoryTreeOptions);

/** One user with the groups it is in. A 404 is an answer -- the user is gone -- and not retried. */
export function useDirectoryUser(guid: string) {
    return useQuery({
        queryKey: queryKeys.directory.user(guid),
        queryFn: () => api.get(`${BASE}/users/${guid}`, DirectoryUserSchema, { fallback: "Could not load the user" }),
        staleTime: STALE_MS,
        retry: false,
    });
}

export function useDirectoryGroup(guid: string) {
    return useQuery({
        queryKey: queryKeys.directory.group(guid),
        queryFn: () => api.get(`${BASE}/groups/${guid}`, DirectoryGroupSchema, { fallback: "Could not load the group" }),
        staleTime: STALE_MS,
        retry: false,
    });
}

export function useDirectoryComputer(guid: string) {
    return useQuery({
        queryKey: queryKeys.directory.computer(guid),
        queryFn: () =>
            api.get(`${BASE}/computers/${guid}`, DirectoryComputerSchema, { fallback: "Could not load the computer" }),
        staleTime: STALE_MS,
        retry: false,
    });
}

/** What lives directly in a container. Not asked while no container is open. */
export function useDirectoryChildren(dn: string | null) {
    return useQuery({
        queryKey: queryKeys.directory.children(dn ?? ""),
        queryFn: () =>
            api.get(`${BASE}/children?${new URLSearchParams({ dn: dn ?? "" })}`, z.array(DirectoryRefSchema), {
                fallback: "Could not load what is in this container",
            }),
        enabled: dn !== null,
        staleTime: STALE_MS,
    });
}

/** Users, groups and computers whose name starts like `query`, for a picker. Not cached under the directory's keys. */
export const searchDirectory = (query: string, types: ("user" | "group" | "computer")[]) =>
    api.get(`${BASE}/search?${new URLSearchParams({ query, types: types.join(",") })}`, z.array(DirectoryRefSchema), {
        fallback: "The search failed",
    });

/**
 * Every change the directory offers. Each is a plain request; `useDirectoryChange` wraps
 * one so that everything read out of the directory is read again once it went through.
 */
export const directoryApi = {
    createUser: (input: CreateDirectoryUser) =>
        api.post(`${BASE}/users`, input, CreatedSchema, { fallback: "Could not create the user" }),
    updateUser: (guid: string, changes: UpdateDirectoryUser) =>
        api.put(`${BASE}/users/${guid}`, changes, undefined, { fallback: "Could not save the user" }),
    setPassword: (guid: string, input: SetPassword) =>
        api.post(`${BASE}/users/${guid}/password`, input, undefined, { fallback: "Could not set the password" }),
    unlockUser: (guid: string) =>
        api.post(`${BASE}/users/${guid}/unlock`, undefined, undefined, { fallback: "Could not unlock the user" }),
    setEnabled: (guid: string, enabled: boolean) =>
        api.post(`${BASE}/accounts/${guid}/enabled`, { enabled }, undefined, {
            fallback: enabled ? "Could not enable the account" : "Could not disable the account",
        }),
    createGroup: (input: CreateGroup) =>
        api.post(`${BASE}/groups`, input, CreatedSchema, { fallback: "Could not create the group" }),
    updateGroup: (guid: string, changes: UpdateGroup) =>
        api.put(`${BASE}/groups/${guid}`, changes, undefined, { fallback: "Could not save the group" }),
    addMembers: (guid: string, members: string[]) =>
        api.post(`${BASE}/groups/${guid}/members`, { members }, undefined, { fallback: "Could not add the members" }),
    removeMembers: (guid: string, members: string[]) =>
        api.post(`${BASE}/groups/${guid}/members/remove`, { members }, undefined, {
            fallback: "Could not remove the member",
        }),
    updateComputer: (guid: string, changes: UpdateComputer) =>
        api.put(`${BASE}/computers/${guid}`, changes, undefined, { fallback: "Could not save the computer" }),
    createOu: (input: CreateOu) =>
        api.post(`${BASE}/ous`, input, CreatedSchema, { fallback: "Could not create the organizational unit" }),
    updateOu: (guid: string, changes: UpdateOu) =>
        api.put(`${BASE}/ous/${guid}`, changes, undefined, { fallback: "Could not save the organizational unit" }),
    moveObject: (guid: string, parentDn: string) =>
        api.post(`${BASE}/objects/${guid}/move`, { parentDn }, undefined, { fallback: "Could not move the object" }),
    renameObject: (guid: string, name: string) =>
        api.post(`${BASE}/objects/${guid}/rename`, { name }, undefined, { fallback: "Could not rename the object" }),
    deleteObject: (guid: string) =>
        api.delete(`${BASE}/objects/${guid}`, { fallback: "Could not delete the object" }),
};

/**
 * Runs a change and has everything read out of the directory read again afterwards. All of
 * it rather than the one entry: a rename shows in the lists, in the groups the object is a
 * member of, and in the container it lives in.
 */
export function useDirectoryChange<TVariables, TResult>(change: (variables: TVariables) => Promise<TResult>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: change,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.directory.all }),
    });
}
