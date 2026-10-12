import WebSocket from "ws";
import { AGENT_EVENTS, agentBaseUrl, isTlsTarget, type AgentRegistrationRequest } from "@sadm/shared";
import { logger } from "../core/logger.js";

/**
 * Dialling an agent: the two routes of its own web server, `/ws/register` for the first
 * contact and `/ws/agent` for every connection after it. Transport only -- who the agent is
 * and what follows from a connection is `DcAgentService`'s.
 */

const TIMEOUT_MS = 10_000;

/** What the operator is told when the agent refused the value they typed. */
const WRONG_PIN =
    "The agent rejected the setup PIN. After five wrong attempts it replaces its PIN -- read the current one from its log.";

/** A readable message for a socket error. One to a name with several addresses arrives as an AggregateError whose own message is empty. */
export function describeSocketError(err: unknown): string {
    const nested = (err as { errors?: unknown[] })?.errors;
    if (Array.isArray(nested) && nested.length > 0) {
        return nested.map((e) => (e instanceof Error ? e.message : String(e))).join("; ");
    }
    if (err instanceof Error) return err.message || (err as NodeJS.ErrnoException).code || err.name;
    return String(err);
}

/** Turns a close of the agent's `/ws/register` without a message into words for the operator. */
export function describeRegistrationClose(code: number, reason: string): string {
    if (code === 4003 && reason === "Already registered") {
        return "The agent is already registered. Delete identity.json in its data directory and restart it, then connect it again with the new setup PIN from its log.";
    }
    if (code === 4003 && reason === "Access denied") {
        return "The agent refused the connection: this server's address is not in its allowedNetworks.";
    }
    if (code === 4003 && reason === "Wrong domain controller") {
        return "The agent at this address runs on another domain controller.";
    }
    if (code === 4003) return WRONG_PIN;
    if (code === 4001) return "The agent closed the registration because the handshake timed out.";
    return `The agent closed the registration connection (code ${code}${reason ? `: ${reason}` : ""}).`;
}

function socketFor(address: string, path: string, allowSelfSigned: boolean): { url: string; options: WebSocket.ClientOptions } {
    return {
        url: `${agentBaseUrl(address)}${path}`,
        // The certificate is checked unless the operator switched that off for the installation.
        options: isTlsTarget(address) ? { rejectUnauthorized: !allowSelfSigned } : {},
    };
}

/**
 * Registers an agent that is waiting on its `/ws/register`: presents the setup PIN and hands
 * it the identity it is to keep. Every way this can end settles the promise -- a bare close
 * is how the agent refuses a caller it does not want.
 */
export function registerAgent(
    address: string,
    request: AgentRegistrationRequest,
    allowSelfSigned: boolean,
): Promise<{ ok: true; hostname: string | null } | { ok: false; error: string }> {
    const { url, options } = socketFor(address, "/ws/register", allowSelfSigned);
    logger.info({ url }, "Registering an agent");

    return new Promise((resolve) => {
        let settled = false;
        let timeout: NodeJS.Timeout | undefined;
        const finish = (result: { ok: true; hostname: string | null } | { ok: false; error: string }) => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            resolve(result);
        };

        let ws: WebSocket;
        try {
            ws = new WebSocket(url, options);
        } catch (err) {
            finish({ ok: false, error: `Could not open the registration connection: ${describeSocketError(err)}` });
            return;
        }
        timeout = setTimeout(() => {
            finish({ ok: false, error: "Registration timed out -- the agent did not respond." });
            ws.terminate();
        }, TIMEOUT_MS);

        ws.on("open", () => ws.send(JSON.stringify({ type: AGENT_EVENTS.REGISTRATION_REQUEST, payload: request })));
        ws.on("message", (data: WebSocket.RawData) => {
            try {
                const message = JSON.parse(data.toString()) as { type?: string; payload?: { error?: unknown; hostname?: unknown } };
                if (message.type === AGENT_EVENTS.REGISTRATION_SUCCESS) {
                    const hostname = message.payload?.hostname;
                    finish({ ok: true, hostname: typeof hostname === "string" ? hostname : null });
                    ws.close(1000, "Registration complete");
                } else if (message.type === AGENT_EVENTS.REGISTRATION_FAILURE) {
                    const error = message.payload?.error;
                    finish({
                        ok: false,
                        error:
                            typeof error === "string" && error !== "Wrong setup PIN or registration secret"
                                ? `The agent rejected the registration: ${error}`
                                : WRONG_PIN,
                    });
                    ws.close();
                }
            } catch {
                finish({ ok: false, error: "The agent sent an invalid response to the registration." });
                ws.close();
            }
        });
        ws.on("error", (err) => finish({ ok: false, error: `Registration connection failed: ${describeSocketError(err)}` }));
        ws.on("close", (code: number, reason: Buffer) => finish({ ok: false, error: describeRegistrationClose(code, reason?.toString() ?? "") }));
    });
}

/**
 * Opens the regular connection to an agent the server dials. The id goes on the wire next to
 * the token: the agent checks the pair and refuses a server that dials it under another
 * domain controller's identity. Resolves with the open socket, or rejects with why not.
 */
export function openAgentSocket(address: string, dcId: string, token: string, allowSelfSigned: boolean): Promise<WebSocket> {
    const { url, options } = socketFor(address, "/ws/agent", allowSelfSigned);
    return new Promise((resolve, reject) => {
        let ws: WebSocket;
        try {
            // The query carries the token; the log line above the call does not.
            ws = new WebSocket(`${url}?clientId=${encodeURIComponent(dcId)}&token=${encodeURIComponent(token)}`, options);
        } catch (err) {
            reject(new Error(describeSocketError(err)));
            return;
        }
        const timeout = setTimeout(() => {
            ws.terminate();
            reject(new Error("Timed out"));
        }, TIMEOUT_MS);
        ws.once("open", () => {
            clearTimeout(timeout);
            resolve(ws);
        });
        ws.once("error", (err) => {
            clearTimeout(timeout);
            reject(new Error(describeSocketError(err)));
        });
    });
}
