import crypto from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Who may call a route: a session, as everywhere -- and on `GET /api/v1/status` alone, also
 * a reader holding the status token.
 *
 * Pure apart from what it is handed, so it is tested without the configuration or the
 * database: the session check comes in as a function.
 */

type Hook = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/**
 * Whether two secrets are equal, in a time that does not depend on where they differ. Both
 * are hashed first, so their lengths do not show either. An empty one never matches.
 */
export function secretEquals(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    const hashA = crypto.createHash("sha256").update(a).digest();
    const hashB = crypto.createHash("sha256").update(b).digest();
    return crypto.timingSafeEqual(hashA, hashB);
}

/** The token of an `Authorization: Bearer <token>` header; null for any other. */
export function bearerOf(header: string | undefined): string | null {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
    return match ? match[1] : null;
}

/**
 * The check every protected route runs: a valid JWT, from the cookie or a Bearer header, of
 * a session that is still current -- the user may have been deleted or had their password
 * changed since the token was signed.
 */
export function sessionHook(isSessionCurrent: (payload: { id?: unknown; tv?: unknown }) => boolean): Hook {
    return async (request, reply) => {
        try {
            await request.jwtVerify();
        } catch (err) {
            return reply.send(err);
        }
        if (!isSessionCurrent(request.user as { id?: unknown; tv?: unknown })) {
            return reply.code(401).send({ error: "Session is no longer valid" });
        }
    };
}

/**
 * The check of `GET /api/v1/status`: the status token, when one is configured and sent; a
 * session otherwise. A wrong token is not told apart from a missing session -- both fall
 * through to the session check and end in the same 401. A token caller has no user:
 * `request.user` stays unset, so what the route answers must not depend on one.
 */
export function statusAuthHook(token: string | null, session: Hook): Hook {
    return async (request, reply) => {
        if (token && secretEquals(bearerOf(request.headers.authorization), token)) return;
        return session(request, reply);
    };
}
