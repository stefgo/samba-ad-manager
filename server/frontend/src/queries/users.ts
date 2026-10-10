import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserListSchema, type CreateUser, type UpdateUser } from "@sadm/shared";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

/**
 * The users who may sign in. Nothing broadcasts a change to them, so the list goes stale
 * by age and is read again by whatever opens it after that -- and at once after a change
 * made here.
 */
export const userListOptions = queryOptions({
    queryKey: queryKeys.users.list(),
    queryFn: () => api.get("/api/v1/users", UserListSchema, { fallback: "Failed to load users" }),
});

export function useUsers() {
    return useQuery(userListOptions);
}

/** Creates a user, or changes the one `id` names. */
export function useSaveUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id?: number; data: CreateUser | UpdateUser }) =>
            id === undefined
                ? api.post("/api/v1/users", data, undefined, { fallback: "Failed to save user" })
                : api.put(`/api/v1/users/${id}`, data, undefined, { fallback: "Failed to save user" }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: userListOptions.queryKey }),
    });
}

export function useDeleteUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => api.delete(`/api/v1/users/${id}`, { fallback: "Failed to delete user" }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: userListOptions.queryKey }),
    });
}
