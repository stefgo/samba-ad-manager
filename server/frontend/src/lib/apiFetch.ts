/**
 * Single entry point for authenticated calls to /api/v1.
 *
 * Before this existed, every caller built its own Authorization header and checked only
 * `res.ok`. Nothing anywhere looked at 401, so once the server refused the JWT the app
 * kept believing it was logged in and every action failed with a generic "Failed to ..."
 * message -- no logout, no redirect, no hint about what had happened.
 */

/** Thrown on 401 so callers can tell an expired session from a real request error. */
export class SessionExpiredError extends Error {
    constructor() {
        super("Session expired");
        this.name = "SessionExpiredError";
    }
}

type UnauthorizedHandler = () => void;

let onUnauthorized: UnauthorizedHandler | null = null;

/**
 * Lets AuthProvider hand over its logout. The session lives in React context, which a
 * plain module cannot read -- so instead of turning auth into a store, the provider
 * registers the one callback this module needs.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
    onUnauthorized = handler;
}

/**
 * The readable half of the session. It carries no secret -- the JWT itself lives in an
 * httpOnly cookie that the browser sends on its own and no script can read. This one only
 * answers "is someone logged in", so the UI can render without asking the server first.
 * Name and meaning are set by the server in services/SessionCookie.ts.
 */
export const SESSION_FLAG_COOKIE = "sadm_auth";

export function hasSessionFlag(): boolean {
    try {
        return document.cookie
            .split(";")
            .some((c) => c.trim().startsWith(`${SESSION_FLAG_COOKIE}=`));
    } catch {
        return false;
    }
}

/** Drops the flag on this side, for when the logout request does not get through. */
export function clearSessionFlag(): void {
    try {
        document.cookie = `${SESSION_FLAG_COOKIE}=; Max-Age=0; Path=/; SameSite=Strict`;
    } catch {
        // Nothing to clear without a document.
    }
}

/**
 * fetch() with the session attached and a single, central reaction to 401.
 *
 * Only for endpoints behind the JWT. /api/login and /api/auth/config are unauthenticated
 * and deliberately keep using plain fetch -- routing them through here would turn a
 * wrong password into a logout-and-redirect instead of an error message.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
    // The session is a cookie, so there is no header to build. "same-origin" rather than
    // "include": every endpoint this calls is served from this very origin, and the
    // narrower value cannot hand the session to a third party by accident.
    const res = await fetch(input, { ...init, credentials: "same-origin" });

    if (res.status === 401) {
        // Drop the dead session and get the user back to the login page. Throwing
        // afterwards keeps callers from treating the 401 body as a valid response.
        onUnauthorized?.();
        throw new SessionExpiredError();
    }

    return res;
}
