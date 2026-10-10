import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { api, ApiError, publicApi } from "./api";
import { SessionExpiredError, setUnauthorizedHandler } from "./apiFetch";

const Thing = z.object({ id: z.number(), name: z.string() });

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fetchMock = vi.fn<typeof fetch>();

/** The `init` of the one request the test made. */
const sentInit = () => fetchMock.mock.calls[0][1] as RequestInit;

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // The unexpected-response path reports to the console by design.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setUnauthorizedHandler(null);
});

describe("api.get", () => {
    it("returns what the schema parsed", async () => {
        fetchMock.mockResolvedValue(json({ id: 1, name: "a" }));
        await expect(api.get("/api/v1/thing", Thing)).resolves.toEqual({ id: 1, name: "a" });
    });

    it("drops a field the schema does not describe", async () => {
        fetchMock.mockResolvedValue(json({ id: 1, name: "a", secret: "x" }));
        await expect(api.get("/api/v1/thing", Thing)).resolves.toEqual({ id: 1, name: "a" });
    });

    it("sends the session along and no body", async () => {
        fetchMock.mockResolvedValue(json({ id: 1, name: "a" }));
        await api.get("/api/v1/thing", Thing);
        expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/thing");
        expect(sentInit()).toMatchObject({ method: "GET", credentials: "same-origin" });
        expect(sentInit().body).toBeUndefined();
    });

    it("throws when the answer does not match the schema", async () => {
        fetchMock.mockResolvedValue(json({ id: "one", name: "a" }));
        const error = await api.get("/api/v1/thing", Thing).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).message).toBe("Unexpected response from GET /api/v1/thing");
        expect(console.error).toHaveBeenCalledTimes(1);
    });

    it("throws when a 200 carries no JSON at all", async () => {
        fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
        await expect(api.get("/api/v1/thing", Thing)).rejects.toThrow("Unexpected response");
    });
});

describe("a refused request", () => {
    it("throws with the server's own error text and the status", async () => {
        fetchMock.mockResolvedValue(json({ error: "Client is offline" }, 409));
        const error = await api.get("/api/v1/thing", Thing).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ message: "Client is offline", status: 409 });
    });

    it("prefers the server's text over the fallback", async () => {
        fetchMock.mockResolvedValue(json({ error: "Client is offline" }, 409));
        await expect(api.get("/api/v1/thing", Thing, { fallback: "Failed" })).rejects.toThrow("Client is offline");
    });

    it("uses the fallback when the body carries no error text", async () => {
        fetchMock.mockResolvedValue(json({}, 500));
        await expect(api.get("/api/v1/thing", Thing, { fallback: "Failed to load" })).rejects.toThrow("Failed to load");
    });

    it("uses the fallback when the body is not JSON", async () => {
        fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502 }));
        await expect(api.get("/api/v1/thing", Thing, { fallback: "Failed to load" })).rejects.toThrow("Failed to load");
    });

    it("ignores an error that is not text", async () => {
        fetchMock.mockResolvedValue(json({ error: { code: 1 } }, 500));
        await expect(api.get("/api/v1/thing", Thing, { fallback: "Failed to load" })).rejects.toThrow("Failed to load");
    });

    it("names the request when there is neither text nor fallback", async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
        await expect(api.delete("/api/v1/thing/1")).rejects.toThrow("DELETE /api/v1/thing/1 failed (HTTP 500)");
    });
});

describe("requests without a response schema", () => {
    it("resolve to nothing and do not read the body", async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
        await expect(api.delete("/api/v1/thing/1")).resolves.toBeUndefined();
    });

    it("do not fail on a body nobody asked for", async () => {
        fetchMock.mockResolvedValue(json({ status: "saved" }));
        await expect(api.post("/api/v1/thing", { name: "a" })).resolves.toBeUndefined();
    });
});

describe("a request body", () => {
    it("is sent as JSON", async () => {
        fetchMock.mockResolvedValue(json({ id: 1, name: "a" }));
        await api.put("/api/v1/thing/1", { name: "a" }, Thing);
        expect(sentInit()).toMatchObject({
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: '{"name":"a"}',
        });
    });

    it("goes out with PATCH as with PUT", async () => {
        fetchMock.mockResolvedValue(json({ id: 1, name: "b" }));
        await expect(api.patch("/api/v1/thing/1", { name: "b" }, Thing)).resolves.toEqual({ id: 1, name: "b" });
        expect(sentInit()).toMatchObject({ method: "PATCH", body: '{"name":"b"}' });
    });

    // Fastify refuses an empty body that claims to be JSON.
    it("is left out entirely, header included, when there is none", async () => {
        fetchMock.mockResolvedValue(json({}));
        await api.post("/api/v1/thing/1/run");
        expect(sentInit().body).toBeUndefined();
        expect(sentInit().headers).toBeUndefined();
    });

    it("is sent when it is an empty object", async () => {
        fetchMock.mockResolvedValue(json({}));
        await api.post("/api/v1/thing", {});
        expect(sentInit().body).toBe("{}");
    });
});

describe("a 401", () => {
    it("logs out and is not an ApiError on an authenticated call", async () => {
        const logout = vi.fn();
        setUnauthorizedHandler(logout);
        fetchMock.mockResolvedValue(json({ error: "Unauthorized" }, 401));
        await expect(api.get("/api/v1/thing", Thing)).rejects.toBeInstanceOf(SessionExpiredError);
        expect(logout).toHaveBeenCalledTimes(1);
    });

    // A wrong password must show in the login form, not bounce the user out of it.
    it("is an ordinary refusal on a public call", async () => {
        const logout = vi.fn();
        setUnauthorizedHandler(logout);
        fetchMock.mockResolvedValue(json({ error: "Invalid credentials" }, 401));
        const error = await publicApi.post("/api/login", { username: "a", password: "b" }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ message: "Invalid credentials", status: 401 });
        expect(logout).not.toHaveBeenCalled();
    });
});

describe("publicApi", () => {
    // The login's value is its Set-Cookie header.
    it("opts into credentials", async () => {
        fetchMock.mockResolvedValue(json({ success: true }));
        await publicApi.post("/api/login", { username: "a", password: "b" });
        expect(sentInit()).toMatchObject({ credentials: "same-origin" });
    });
});
