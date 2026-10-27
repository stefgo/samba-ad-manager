import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { bearerOf, secretEquals, sessionHook, statusAuthHook } from "./statusAuth.js";

const TOKEN = "s".repeat(40);
const COOKIE = "test_session";

/**
 * A server with the plugins the check needs and two routes: `/status` as the status route is
 * guarded, `/other` as every other protected route is.
 */
async function buildServer({ token = TOKEN as string | null, current = true } = {}) {
    const server = Fastify();
    await server.register(cookie);
    await server.register(jwt, { secret: "test-secret", cookie: { cookieName: COOKIE, signed: false } });
    const session = sessionHook(() => current);
    server.get("/status", { onRequest: statusAuthHook(token, session) }, async (request) => ({ ok: true, user: request.user ?? null }));
    server.get("/other", { onRequest: session }, async () => ({ ok: true }));
    const jwtToken = server.jwt.sign({ id: 1, username: "admin", tv: 0 });
    return { server, jwtToken };
}

describe("statusAuthHook", () => {
    it("lets the status token in, without a user", async () => {
        const { server } = await buildServer();
        const response = await server.inject({ url: "/status", headers: { authorization: `Bearer ${TOKEN}` } });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ ok: true, user: null });
    });

    it("refuses a wrong token as it refuses a missing session", async () => {
        const { server } = await buildServer();
        const wrong = await server.inject({ url: "/status", headers: { authorization: `Bearer ${"x".repeat(40)}` } });
        const none = await server.inject({ url: "/status" });
        expect(wrong.statusCode).toBe(401);
        expect(none.statusCode).toBe(401);
    });

    it("lets no token in when none is configured", async () => {
        const { server } = await buildServer({ token: null });
        const response = await server.inject({ url: "/status", headers: { authorization: `Bearer ${TOKEN}` } });
        expect(response.statusCode).toBe(401);
    });

    it("still takes a session, from the header or the cookie", async () => {
        const { server, jwtToken } = await buildServer();
        const header = await server.inject({ url: "/status", headers: { authorization: `Bearer ${jwtToken}` } });
        const fromCookie = await server.inject({ url: "/status", cookies: { [COOKIE]: jwtToken } });
        expect(header.statusCode).toBe(200);
        expect(fromCookie.statusCode).toBe(200);
    });

    it("refuses a session that is no longer current", async () => {
        const { server, jwtToken } = await buildServer({ current: false });
        const response = await server.inject({ url: "/status", cookies: { [COOKIE]: jwtToken } });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: "Session is no longer valid" });
    });

    it("is worth nothing on any other route", async () => {
        const { server } = await buildServer();
        const response = await server.inject({ url: "/other", headers: { authorization: `Bearer ${TOKEN}` } });
        expect(response.statusCode).toBe(401);
    });
});

describe("secretEquals", () => {
    it("matches equal secrets only", () => {
        expect(secretEquals(TOKEN, TOKEN)).toBe(true);
        expect(secretEquals(TOKEN, `${TOKEN}x`)).toBe(false);
        expect(secretEquals(TOKEN, "short")).toBe(false);
    });

    it("never matches an empty one", () => {
        expect(secretEquals("", "")).toBe(false);
        expect(secretEquals(null, TOKEN)).toBe(false);
        expect(secretEquals(TOKEN, undefined)).toBe(false);
    });
});

describe("bearerOf", () => {
    it("reads the token of a Bearer header", () => {
        expect(bearerOf("Bearer abc")).toBe("abc");
        expect(bearerOf("bearer abc")).toBe("abc");
    });

    it("reads nothing out of any other header", () => {
        expect(bearerOf(undefined)).toBeNull();
        expect(bearerOf("Basic abc")).toBeNull();
        expect(bearerOf("Bearer")).toBeNull();
        expect(bearerOf("Bearer a b")).toBeNull();
    });
});
