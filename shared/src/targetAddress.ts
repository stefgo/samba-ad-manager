import { DEFAULT_AGENT_PORT } from "./constants.js";

/** The prefix a TLS target carries. The only encrypted scheme, and the only one stored. */
const TLS_PREFIX = "wss://";

/**
 * The address of an outbound agent, as `host:port` or `wss://host:port`.
 *
 * The value is interpolated into `<scheme>://<address>/ws/agent` and `/ws/register`, so
 * everything a URL could read as something other than a host has to be refused here: a
 * path, a query, a fragment, or credentials. A stray slash would otherwise send the agent
 * connection somewhere else without a word. Of the schemes, only `ws://` and `wss://` are
 * accepted -- an `http://` would parse perfectly well and mean nothing here.
 *
 * A bare host is accepted and gets the default port appended, because that is the port an
 * agent listens on unless its config says otherwise -- the address stays canonical either
 * way, which is what the reconnect logic compares.
 *
 * The canonical form is deliberately asymmetric: plaintext keeps the bare `host:port` it
 * has always had, and only TLS carries a prefix. Every address stored before TLS existed
 * therefore normalises to exactly the bytes it already holds, which is what lets this ship
 * without a migration or a backfill -- and what keeps the "has the address changed?" check
 * in the update endpoint from firing for every client at once.
 *
 * Shared because the client editor has to reject an address with the same rule the endpoint
 * that stores it applies; two copies would be two answers to one question.
 *
 * @returns the normalised address, or null when the value is not a usable one.
 */
export function normaliseTargetAddress(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Split off the scheme before the authority is checked: the slashes that make it a
    // scheme are the very characters the check below refuses.
    const scheme = /^(wss?):\/\/(.*)$/i.exec(trimmed);
    const tls = scheme ? scheme[1].toLowerCase() === "wss" : false;
    const authority = scheme ? scheme[2] : trimmed;
    if (!authority || /[\s/@\\?#]/.test(authority)) return null;

    try {
        const url = new URL(`ws://${authority}`);
        if (!url.hostname) return null;
        // `new URL` keeps only host and port from the authority; anything else in the input
        // was already refused above. An empty port means the input carried none.
        const host = url.port ? url.host : `${url.host}:${DEFAULT_AGENT_PORT}`;
        return tls ? `${TLS_PREFIX}${host}` : host;
    } catch {
        return null;
    }
}

/**
 * Whether the server reaches this agent over TLS. Expects a normalised address, which is
 * what the database holds -- `normaliseTargetAddress` is what puts the prefix there.
 */
export function isTlsTarget(address: string): boolean {
    return address.toLowerCase().startsWith(TLS_PREFIX);
}

/**
 * The base URL of an agent's WebSocket routes, so the scheme is decided in one place
 * instead of being interpolated at each of the connector's call sites.
 */
export function agentBaseUrl(address: string): string {
    return isTlsTarget(address) ? address : `ws://${address}`;
}
