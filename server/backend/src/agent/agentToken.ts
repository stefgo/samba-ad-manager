import crypto from "crypto";

/**
 * The tokens of the agents, as far as they are arithmetic.
 *
 * Every token is kept as its SHA-256, never as itself. An agent that dials in presents its
 * token and the hash is compared. An agent the server dials has to be *shown* the token, so
 * the server must be able to produce it again -- and does, from a nonce in the database and
 * its own secret in config.yaml. Neither alone is the token: a copy of the database does not
 * let anybody dial an agent.
 */

export const hashToken = (token: string): string => crypto.createHash("sha256").update(token, "utf8").digest("hex");

/** A token nobody can guess, in characters a URL and a YAML file take as they are. */
export const newToken = (): string => crypto.randomBytes(32).toString("base64url");

/** The token of the outbound agent of `dcId`, from the nonce stored for it and this server's secret. */
export function deriveOutboundToken(secret: string, dcId: string, nonce: string): string {
    return crypto.createHmac("sha256", secret).update(`sadm-agent\n${dcId.toLowerCase()}\n${nonce}`, "utf8").digest("base64url");
}

/** Whether two hashes are the same, in time that does not depend on where they differ. */
export function sameHash(a: string, b: string): boolean {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** How long a registration token is good for. */
export const REGISTRATION_TOKEN_TTL_MS = 60 * 60_000;

/** The waits between two attempts to reach an agent the server dials: the same ladder the agent climbs when it dials. */
const RECONNECT_DELAYS_MS = [5000, 10000, 30000, 60000];

/** How long to wait before attempt number `attempt` (0 for the first one after a loss). */
export const reconnectDelay = (attempt: number): number =>
    RECONNECT_DELAYS_MS[Math.min(Math.max(attempt, 0), RECONNECT_DELAYS_MS.length - 1)];
