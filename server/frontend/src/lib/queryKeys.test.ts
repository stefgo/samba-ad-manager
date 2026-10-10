import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { isPushedOnConnect, queryKeys } from "./queryKeys";

/** Whether invalidating `prefix` reaches `key` -- asked of the cache itself, not rebuilt here. */
function reaches(prefix: readonly unknown[], key: readonly unknown[]): boolean {
    const queryClient = new QueryClient();
    queryClient.setQueryData(key, "cached");
    return queryClient.getQueryCache().findAll({ queryKey: prefix }).length === 1;
}

describe("queryKeys", () => {
    it("reaches each entry from the `all` of its area", () => {
        expect(reaches(queryKeys.clients.all, queryKeys.clients.list())).toBe(true);
        expect(reaches(queryKeys.dcHealth.all, queryKeys.dcHealth.states())).toBe(true);
        expect(reaches(queryKeys.activity.all, queryKeys.activity.list())).toBe(true);
    });

    // The client list is its own entry: the measurements are not below it, so a
    // CLIENTS_UPDATE that replaces the list leaves every measurement where it is.
    it("does not reach the measurements from the client list", () => {
        expect(reaches(queryKeys.clients.all, queryKeys.dcHealth.states())).toBe(false);
    });

    it("reaches the scheduler status from settings.all, and nothing else from there", () => {
        expect(reaches(queryKeys.settings.all, queryKeys.settings.schedulerStatus())).toBe(true);
        expect(reaches(queryKeys.settings.all, queryKeys.webhooks.list())).toBe(false);
    });
});

/**
 * What the socket handler relies on: an update is written with a function that receives
 * what is cached, and an entry that was never read is not created by it.
 */
describe("an update to an entry that was never read", () => {
    let queryClient: QueryClient;
    const key = queryKeys.activity.list();

    beforeEach(() => {
        queryClient = new QueryClient();
    });

    it("creates no entry", () => {
        queryClient.setQueryData<string[]>(key, (events) => events && [...events, "e1"]);
        expect(queryClient.getQueryData(key)).toBeUndefined();
        expect(queryClient.getQueryCache().find({ queryKey: key })).toBeUndefined();
    });

    it("changes one that was", () => {
        queryClient.setQueryData<string[]>(key, []);
        queryClient.setQueryData<string[]>(key, (events) => events && [...events, "e1"]);
        expect(queryClient.getQueryData(key)).toEqual(["e1"]);
    });
});

describe("isPushedOnConnect", () => {
    it("names what the server sends on every connect", () => {
        expect(isPushedOnConnect(queryKeys.clients.list())).toBe(true);
        expect(isPushedOnConnect(queryKeys.dcHealth.states())).toBe(true);
        expect(isPushedOnConnect(queryKeys.activity.list())).toBe(true);
    });

    // The scheduler status is broadcast when it changes, but not sent to a socket that
    // connects; the rest is never sent at all.
    it("leaves out what has to be read again after a reconnect", () => {
        expect(isPushedOnConnect(queryKeys.settings.schedulerStatus())).toBe(false);
        expect(isPushedOnConnect(queryKeys.webhooks.list())).toBe(false);
        expect(isPushedOnConnect(queryKeys.users.list())).toBe(false);
        expect(isPushedOnConnect(queryKeys.tokens.list())).toBe(false);
    });
});
