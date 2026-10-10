import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * The browser session, as two cookies.
 *
 * The JWT used to reach the browser three times over: in the OIDC redirect's query string,
 * in `localStorage`, and again in the dashboard WebSocket URL. The first and the third end
 * up in proxy and server access logs; the second is readable by any script that gets a
 * foothold on the page.
 *
 * So the token no longer reaches JavaScript at all -- the shape "OAuth 2.0 for
 * Browser-Based Apps" recommends. The browser carries the cookie by itself, including on
 * the WebSocket handshake, which is what lets the query parameter go there too.
 */

/** Holds the JWT. httpOnly, so no script can read it -- not even the dashboard's own. */
export const SESSION_COOKIE = "sadm_session";

/**
 * Carries no secret. It only tells the UI whether to render the login form without
 * asking the server first, and it is readable on purpose.
 */
export const SESSION_FLAG_COOKIE = "sadm_auth";

/**
 * Seconds until the token expires, for the cookies' Max-Age.
 *
 * Taken from the token that was just signed rather than parsed out of `jwtExpiresIn`:
 * the cookie must not outlive the token it carries -- a browser holding a cookie the
 * server rejects looks logged in and fails on every action -- and reading `exp` agrees
 * with the signer for every format it accepts, not only the ones a parser here knows.
 */
function maxAgeSeconds(request: FastifyRequest, token: string): number {
    const { exp } = request.server.jwt.decode<{ exp?: number }>(token) ?? {};
    if (typeof exp !== "number") return 0;
    return Math.max(0, exp - Math.floor(Date.now() / 1000));
}

/**
 * Whether the cookies may be marked `Secure`.
 *
 * Read from the request instead of fixed: `Secure` makes the browser withhold a cookie
 * over plain HTTP, and many installations run on http:// inside a home network. Set
 * unconditionally, those would log in successfully and be rejected on the very next
 * request, with nothing in the UI to explain it -- a failure localhost never shows,
 * because browsers treat it as a secure context. Behind a TLS-terminating proxy this is
 * the scheme the browser used only if that proxy is listed in `security.trusted_proxies`;
 * X-Forwarded-Proto from anyone else is ignored, and the cookies then go without `Secure`.
 */
function isSecureRequest(request: FastifyRequest): boolean {
    return request.protocol === "https";
}

/** Issues both cookies for a freshly signed session token. */
export function setSessionCookies(
    request: FastifyRequest,
    reply: FastifyReply,
    token: string,
): void {
    const secure = isSecureRequest(request);
    const maxAge = maxAgeSeconds(request, token);

    reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        // strict rather than lax: every request the dashboard makes is same-origin (the
        // backend serves the SPA, and Vite proxies to it in development), so no cross-site
        // navigation legitimately needs the session. Together with CORS origin: false
        // that is also what keeps cross-site request forgery out.
        sameSite: "strict",
        secure,
        path: "/",
        maxAge,
    });

    reply.setCookie(SESSION_FLAG_COOKIE, "1", {
        httpOnly: false,
        sameSite: "strict",
        secure,
        path: "/",
        maxAge,
    });
}

/** Clears both cookies. The httpOnly one can only be removed from here. */
export function clearSessionCookies(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.clearCookie(SESSION_FLAG_COOKIE, { path: "/" });
}
