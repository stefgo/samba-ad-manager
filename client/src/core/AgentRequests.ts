import {
    AGENT_ACTIONS,
    AgentRequestSchema,
    isAgentAction,
    type AgentAction,
    type AgentActionResult,
    type AgentErrorCode,
    type AgentResponse,
} from "@sadm/shared";
import { logger } from "@sadm/shared/node";
import type { z } from "zod";
import { HealthService } from "../services/HealthService.js";

/** A refusal with its reason, as the server is told it. Anything else thrown is `failed`. */
export class AgentActionError extends Error {
    readonly code: AgentErrorCode;

    constructor(code: AgentErrorCode, message: string) {
        super(message);
        this.name = "AgentActionError";
        this.code = code;
    }
}

type Handlers = {
    [A in AgentAction]: (payload: z.output<(typeof AGENT_ACTIONS)[A]["payload"]>) => Promise<AgentActionResult<A>>;
};

/**
 * Everything the server can make this agent do. An action that is not in this table does
 * not exist for this agent, whatever the server sends -- and since `Handlers` is keyed by
 * `AGENT_ACTIONS`, one that is listed there without a handler here does not compile.
 */
const HANDLERS: Handlers = {
    "health.refresh": async () => {
        await HealthService.refresh();
        return {};
    },
    "health.dbcheck": async () => {
        const { errors, error } = await HealthService.runDbcheck();
        // The measurement that follows carries the result to every dashboard.
        void HealthService.refresh().catch(() => undefined);
        return { errors, error };
    },
};

/**
 * Handles one `AGENT_REQUEST` and returns the `AGENT_RESPONSE` for it -- or null for a
 * message that names no request to answer.
 */
export async function handleAgentRequest(raw: unknown): Promise<AgentResponse | null> {
    const request = AgentRequestSchema.safeParse(raw);
    if (!request.success) {
        logger.warn({ issues: request.error.issues }, "Ignoring malformed AGENT_REQUEST from server");
        return null;
    }
    const { requestId, action } = request.data;
    const refuse = (code: AgentErrorCode, message: string): AgentResponse => ({
        requestId,
        ok: false,
        error: { code, message },
    });

    if (!isAgentAction(action)) return refuse("unknown-action", `This agent does not know the action ${action}`);
    const payload = AGENT_ACTIONS[action].payload.safeParse(request.data.payload);
    if (!payload.success) {
        const issue = payload.error.issues[0];
        return refuse("invalid", `${issue.path.join(".") || "payload"}: ${issue.message}`);
    }

    try {
        const handler = HANDLERS[action] as (payload: unknown) => Promise<unknown>;
        return { requestId, ok: true, result: await handler(payload.data) };
    } catch (err) {
        if (err instanceof AgentActionError) return refuse(err.code, err.message);
        logger.warn({ err, action }, "An agent action failed");
        return refuse("failed", err instanceof Error ? err.message : String(err));
    }
}
