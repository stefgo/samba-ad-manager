import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { readUnlessPushed } from "./queryClient";

const key = ["clients", "list"];

/** A request whose answer the test hands over when it chooses to. */
function pendingRead<T>() {
    let answer!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        answer = resolve;
    });
    return { read: () => promise, answer };
}

/**
 * The order of a push and a request, both ways round. `dataUpdatedAt` is a clock reading,
 * so the clock is moved by hand: two writes within one millisecond would look like one.
 */
describe("readUnlessPushed", () => {
    let queryClient: QueryClient;

    beforeEach(() => {
        vi.useFakeTimers({ now: 1_000 });
        queryClient = new QueryClient();
        return () => vi.useRealTimers();
    });

    it("returns the answer when nothing was pushed", async () => {
        expect(await readUnlessPushed(queryClient, key, async () => ["fetched"])).toEqual(["fetched"]);
    });

    it("returns the answer over what was cached before the request", async () => {
        queryClient.setQueryData(key, ["old"]);
        vi.advanceTimersByTime(10);
        expect(await readUnlessPushed(queryClient, key, async () => ["fetched"])).toEqual(["fetched"]);
    });

    // The first load: the socket connects and delivers the list before the request answers.
    it("keeps a push that made the entry while the request was under way", async () => {
        const { read, answer } = pendingRead<string[]>();
        const result = readUnlessPushed(queryClient, key, read);
        vi.advanceTimersByTime(10);
        queryClient.setQueryData(key, ["pushed"]);
        answer(["fetched"]);
        expect(await result).toEqual(["pushed"]);
    });

    // A reload: the answer was read before the change the push reports.
    it("keeps a push that replaced the entry while the request was under way", async () => {
        queryClient.setQueryData(key, ["old"]);
        vi.advanceTimersByTime(10);
        const { read, answer } = pendingRead<string[]>();
        const result = readUnlessPushed(queryClient, key, read);
        vi.advanceTimersByTime(10);
        queryClient.setQueryData(key, ["pushed"]);
        answer(["fetched"]);
        expect(await result).toEqual(["pushed"]);
    });

    it("passes a refusal through", async () => {
        await expect(
            readUnlessPushed(queryClient, key, async () => {
                throw new Error("refused");
            }),
        ).rejects.toThrow("refused");
    });
});
