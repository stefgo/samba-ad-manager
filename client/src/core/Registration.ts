import os from "os";
import { AgentRegistrationResponseSchema } from "@sadm/shared";
import { config } from "./Config.js";
import { getDcId } from "./DcIdentity.js";
import { setIdentity } from "./Identity.js";
import { logger } from "./logger.js";
import { setServerUrl } from "./RegistrationState.js";
import { isCertificateError, serverRequest, type ServerResponse } from "./ServerHttp.js";

/**
 * How a registration with the server went.
 *
 * `stage` says where it stopped: `server` when nothing answered at the URL -- worth another
 * try -- and `register` when a server answered and refused, which no retry changes.
 */
export type RegistrationResult =
    | { ok: true; identityStored: boolean; urlStored: boolean }
    | { ok: false; stage: "server" | "register"; error: string };

/**
 * Registers this agent with the server at `url`: sends the registration token and the id of
 * the domain controller it runs on, and stores the identity that comes back.
 *
 * The one implementation behind both ways in -- the register page and the environment -- so
 * the two cannot come to differ in what they send or what they keep.
 */
export async function registerWithServer(url: string, token: string): Promise<RegistrationResult> {
    const dcId = getDcId();
    if (!dcId) return { ok: false, stage: "register", error: "The local database has not been read yet" };

    let response: ServerResponse;
    try {
        // The registration token goes out and the auth token comes back, so the certificate
        // is checked unless the operator decided otherwise.
        response = await serverRequest(`${url.replace(/\/+$/, "")}/api/v1/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, dcId, hostname: os.hostname() }),
            allowSelfSigned: config.allowSelfSignedCertificates,
        });
    } catch (err) {
        if (isCertificateError(err)) {
            return {
                ok: false,
                stage: "register",
                error:
                    `The server's certificate could not be verified (${(err as Error).message}). ` +
                    "If it is self-signed on purpose, set allowSelfSignedCertificates: true in this agent's config.yaml " +
                    "(or SADM_ALLOW_SELF_SIGNED=true) and restart it.",
            };
        }
        return {
            ok: false,
            stage: "server",
            error: `Server not reachable at ${url} (${err instanceof Error ? err.message : String(err)})`,
        };
    }

    if (!response.ok) {
        let error = response.text || `HTTP ${response.status}`;
        try {
            const json = JSON.parse(response.text) as { error?: unknown };
            if (typeof json.error === "string") error = json.error;
        } catch {
            // Not JSON: the text itself is the reason.
        }
        // A server that is still starting, or a proxy in front of one that is down.
        return { ok: false, stage: response.status >= 500 ? "server" : "register", error };
    }

    let parsed;
    try {
        parsed = AgentRegistrationResponseSchema.safeParse(JSON.parse(response.text));
    } catch {
        parsed = null;
    }
    if (!parsed?.success) {
        return { ok: false, stage: "register", error: "The server did not return a token and client id" };
    }

    // Both are stored before anything else is reported: the server has registered this agent
    // either way, so what is still open is only whether it will know that after a restart.
    const identityStored = setIdentity(parsed.data.clientId, parsed.data.token);
    const urlStored = setServerUrl(url);
    logger.info({ clientId: parsed.data.clientId }, "Registered with the server, identity received");
    return { ok: true, identityStored, urlStored };
}

/**
 * What to tell the operator when a registration could not be stored, or null when both
 * halves are on disk. The identity and the server URL live in different files, and which of
 * them failed decides what has to be made writable.
 */
export function registrationWarning(identityStored: boolean, urlStored: boolean): string | null {
    if (identityStored && urlStored) return null;
    const what = !identityStored ? "the identity in this agent's data directory" : "the server URL in this agent's config.yaml";
    return (
        `Registered, but ${what} could not be written. ` +
        "The agent is connected now and will come back unregistered after a restart -- " +
        "make the file writable and register again."
    );
}

/** How long to wait before the next attempt, by how many have failed. */
const RETRY_DELAYS_MS = [5000, 10000, 30000, 60000];

/**
 * Registers from the environment, for an agent nobody opens a page of: `SADM_SERVER_URL` and
 * `SADM_REGISTRATION_TOKEN`. Tries again while no server answers -- the domain controller may
 * well be up before the server is -- and gives up when the server refuses, because a token
 * that is wrong or used stays that.
 *
 * Answers whether the agent is registered afterwards.
 */
export async function registerFromEnvironment(url: string, token: string): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
        const result = await registerWithServer(url, token);
        if (result.ok) {
            const warning = registrationWarning(result.identityStored, result.urlStored);
            if (warning) logger.error(warning);
            logger.info("Remove SADM_REGISTRATION_TOKEN(_FILE) from this agent's environment: the token is used");
            return true;
        }
        if (result.stage === "register") {
            logger.error(
                `Registration refused: ${result.error}. Issue a new token on the domain controller's page and restart this agent.`,
            );
            return false;
        }
        const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
        logger.warn(`${result.error}. Trying to register again in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
}
