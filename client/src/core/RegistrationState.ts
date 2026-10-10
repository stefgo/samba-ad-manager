import path from "path";
import { logger } from "@sadm/shared/node";
import { REGISTRATION_SECRET, config } from "./Config.js";
import { setValue, save } from "./ConfigFile.js";
import { getIdentity } from "./Identity.js";

/**
 * Which way the link to the server runs, named from the server's side.
 *
 * - `unregistered` -- no identity yet; the agent is waiting to be registered, through its own
 *   web UI or by the server dialling `/ws/register` -- with the setup PIN either way, or with
 *   `SADM_REGISTRATION_SECRET` on `/ws/register`.
 * - `inbound` -- the agent dials the server and owns the reconnect ladder.
 * - `outbound` -- the server dials the agent, which is what an identity without a server URL
 *   means.
 */
export type AgentMode = "unregistered" | "inbound" | "outbound";

/**
 * The two values registration changes. Only the server URL is written back into the
 * operator's config.yaml; the registration secret comes from the environment and is only
 * dropped from memory once it has been used.
 *
 * They are kept here rather than in `config`, which is frozen: `config` is what the operator
 * wrote, this is what is true now. The identity is not among them -- it never belonged in
 * that file (see Identity.ts).
 */
let serverUrl: string | null = config.serverUrl?.trim() || null;
let registrationSecret: string | null = REGISTRATION_SECRET;

export function getServerUrl(): string | null {
    return serverUrl;
}

/**
 * Stores the server URL a registration went to. Answers whether it reached the file.
 *
 * Writes nothing when the value is already there, which is the usual case: an operator who
 * put the URL in config.yaml before registering leaves the file untouched, and a file that
 * is not written cannot be written wrongly.
 */
export function setServerUrl(url: string): boolean {
    const next = url.trim();
    if (next === serverUrl) return true;
    serverUrl = next;
    setValue("serverUrl", next);
    return save();
}

/**
 * The WebSocket URL for `inbound` mode, derived rather than stored: it is the server URL with
 * the scheme swapped and `/ws/agent` appended, and a second copy of a value is a second value
 * that can be wrong.
 *
 * Answers null when there is no server URL -- `outbound` mode, where the server dials in --
 * or when what the operator wrote is not a URL. The latter is a warning, not a refusal to
 * start: it costs the connection, not the web UI they would correct it in.
 */
export function getWebSocketUrl(): string | null {
    if (!serverUrl) return null;
    try {
        const url = new URL(serverUrl);
        if (url.protocol === "http:") url.protocol = "ws:";
        else if (url.protocol === "https:") url.protocol = "wss:";
        if (!url.pathname.endsWith("/ws/agent")) {
            url.pathname = path.join(url.pathname, "ws/agent");
        }
        return url.toString();
    } catch {
        logger.warn({ serverUrl }, "serverUrl in config.yaml is not a URL");
        return null;
    }
}

export function getRegistrationSecret(): string | null {
    return registrationSecret;
}

/**
 * Drops the registration secret once it has been used. Only from memory: the environment it
 * came from is not this process's to change, so the operator is told to remove it. It would do
 * no harm meanwhile -- `/ws/register` refuses every caller once the agent has an identity.
 */
export function consumeRegistrationSecret(): void {
    if (!registrationSecret) return;
    registrationSecret = null;
    logger.info(
        "Registration secret used -- remove SADM_REGISTRATION_SECRET(_FILE) from this agent's environment",
    );
}

export function getAgentMode(): AgentMode {
    if (!getIdentity()) return "unregistered";
    return serverUrl ? "inbound" : "outbound";
}

// Said once at startup, because the difference decides who dials whom and there is no other
// place an operator would see it. An identity without a server URL is the outbound case --
// and the one state a half-written registration would leave behind, so it is worth naming.
if (getAgentMode() === "inbound") {
    logger.info(`Using Server URL from config: ${serverUrl}`);
} else if (getAgentMode() === "outbound") {
    logger.info("Registered without a serverUrl -- outbound mode: the server dials this agent");
}
