import crypto from "crypto";
import {
    AGENT_ACTIONS,
    AGENT_ACTION_TIMEOUT_MS,
    AgentResponseSchema,
    WS_EVENTS,
    type AgentAction,
    type AgentActionPayload,
    type AgentActionResult,
    type AgentErrorCode,
} from "@sadm/shared";
import { logger } from "@sadm/shared/node";
import { ProxyService } from "./ProxyService.js";

/**
 * Why a request to an agent brought no result.
 *
 * - `offline`: no agent is connected under that id, or it went away before it answered.
 * - `timeout`: it did not answer in time. The action may still be running -- or done.
 * - `unsupported`: the agent does not implement the action; an older build.
 * - `invalid` / `forbidden` / `failed`: the agent's own refusal, with its reason.
 * - `protocol`: an answer came, in a form this server does not know.
 */
export type AgentRpcErrorCode = "offline" | "timeout" | "unsupported" | "protocol" | Exclude<AgentErrorCode, "unknown-action">;

export class AgentRpcError extends Error {
    readonly code: AgentRpcErrorCode;

    constructor(code: AgentRpcErrorCode, message: string) {
        super(message);
        this.name = "AgentRpcError";
        this.code = code;
    }
}

interface Pending {
    clientId: string;
    action: AgentAction;
    resolve: (result: unknown) => void;
    reject: (error: AgentRpcError) => void;
    timer: NodeJS.Timeout;
}

/**
 * Asks an agent to do one of the actions in `AGENT_ACTIONS` and waits for its answer.
 *
 * The agent protocol was one-way before this: an agent reports, the server listens. Managing
 * a directory needs an answer -- did the user get created, and if not, why. A request
 * carries an id, the agent answers under it, and whatever does not come back in time is
 * given up on here rather than waited for.
 */
export class AgentRpc {
    private static pending = new Map<string, Pending>();

    static {
        // An agent that disconnects answers nothing any more: fail what waits for it at once
        // instead of at its timeout. Also runs when an agent connects, where it finds nothing.
        ProxyService.onConnectionChange((clientId) => {
            if (ProxyService.getClientSocket(clientId)) return;
            for (const [requestId, entry] of this.pending) {
                if (entry.clientId !== clientId) continue;
                this.settle(requestId)?.reject(new AgentRpcError("offline", "The agent disconnected before it answered"));
            }
        });
    }

    private static settle(requestId: string): Pending | undefined {
        const entry = this.pending.get(requestId);
        if (!entry) return undefined;
        clearTimeout(entry.timer);
        this.pending.delete(requestId);
        return entry;
    }

    static async request<A extends AgentAction>(
        clientId: string,
        action: A,
        payload: AgentActionPayload<A>,
    ): Promise<AgentActionResult<A>> {
        const requestId = crypto.randomUUID();
        const result = await new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.settle(requestId)?.reject(
                    new AgentRpcError("timeout", `The agent did not answer within ${Math.round(AGENT_ACTION_TIMEOUT_MS[action] / 1000)} s`),
                );
            }, AGENT_ACTION_TIMEOUT_MS[action]);
            timer.unref?.();
            this.pending.set(requestId, { clientId, action, resolve, reject, timer });
            try {
                ProxyService.sendFireAndForget(clientId, WS_EVENTS.AGENT_REQUEST, { requestId, action, payload });
            } catch {
                this.settle(requestId);
                reject(new AgentRpcError("offline", "The agent is not connected"));
            }
        });

        const parsed = AGENT_ACTIONS[action].result.safeParse(result);
        if (!parsed.success) {
            logger.warn({ clientId, action, issues: parsed.error.issues }, "An agent answered with an unexpected result");
            throw new AgentRpcError("protocol", "The agent answered in a form this server does not know");
        }
        return parsed.data as AgentActionResult<A>;
    }

    /** `AGENT_RESPONSE` from an agent. An answer nobody waits for -- too late, or not ours -- is dropped. */
    static handleResponse(clientId: string, payload: unknown): void {
        const parsed = AgentResponseSchema.safeParse(payload);
        if (!parsed.success) {
            logger.warn({ clientId, issues: parsed.error.issues }, "Ignoring malformed AGENT_RESPONSE from agent");
            return;
        }
        const response = parsed.data;
        const waiting = this.pending.get(response.requestId);
        // The id alone is not enough: an agent must not be able to answer another one's request.
        if (!waiting || waiting.clientId !== clientId) {
            logger.debug({ clientId, requestId: response.requestId }, "Dropping an agent response nobody waits for");
            return;
        }
        this.settle(response.requestId);
        if (response.ok) {
            waiting.resolve(response.result);
            return;
        }
        const code = response.error?.code ?? "failed";
        waiting.reject(
            new AgentRpcError(
                code === "unknown-action" ? "unsupported" : code,
                response.error?.message ?? "The agent refused without a reason",
            ),
        );
    }
}

/** The HTTP status a failed request to an agent is answered with. */
export function agentRpcStatus(error: AgentRpcError): number {
    switch (error.code) {
        case "offline":
            return 409;
        case "timeout":
            return 504;
        case "unsupported":
            return 501;
        case "invalid":
            return 400;
        case "forbidden":
            return 403;
        case "protocol":
        case "failed":
            return 502;
    }
}
