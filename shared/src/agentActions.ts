import { z } from "zod";

/**
 * What the server may ask an agent to do, and what the agent answers.
 *
 * A request names one action out of a fixed list. There is no action that runs a command:
 * the agent does what it implements and nothing a server -- or whoever took it over -- might
 * think of. Each action carries the schema of its payload and of its result, so both ends
 * check the same shapes.
 */

/** Each action with the payload it takes and the result it gives. */
export const AGENT_ACTIONS = {
    /** Measure now and send the measurement, whether or not anything changed. */
    "health.refresh": {
        payload: z.object({}),
        result: z.object({}),
    },
    /** Run the database check now. Answers once it has finished, which may take minutes. */
    "health.dbcheck": {
        payload: z.object({}),
        result: z.object({ errors: z.number().int().nullable(), error: z.string().nullish() }),
    },
} as const;

export type AgentAction = keyof typeof AGENT_ACTIONS;
export type AgentActionPayload<A extends AgentAction> = z.input<(typeof AGENT_ACTIONS)[A]["payload"]>;
export type AgentActionResult<A extends AgentAction> = z.output<(typeof AGENT_ACTIONS)[A]["result"]>;

export const isAgentAction = (action: string): action is AgentAction =>
    Object.prototype.hasOwnProperty.call(AGENT_ACTIONS, action);

/** How long the server waits for an answer before it gives up on a request, per action. */
export const AGENT_ACTION_TIMEOUT_MS: Record<AgentAction, number> = {
    "health.refresh": 30_000,
    "health.dbcheck": 10 * 60_000,
};

/** `AGENT_REQUEST`, server to agent. The payload is checked against the action's schema. */
export const AgentRequestSchema = z.object({
    requestId: z.string().min(1),
    action: z.string().min(1),
    payload: z.unknown(),
});

/**
 * Why an agent did not do what it was asked.
 *
 * - `unknown-action`: this agent does not implement the action -- an older build.
 * - `invalid`: the payload did not fit, or the action refuses these values.
 * - `forbidden`: the agent's own configuration does not allow it (read-only, protected object).
 * - `failed`: it was tried, and the directory or Samba refused.
 */
export const AGENT_ERROR_CODES = ["unknown-action", "invalid", "forbidden", "failed"] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

/** `AGENT_RESPONSE`, agent to server: the result, or why there is none. */
export const AgentResponseSchema = z.object({
    requestId: z.string().min(1),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z
        .object({
            code: z.enum(AGENT_ERROR_CODES).catch("failed"),
            message: z.string(),
        })
        .optional(),
});

export type AgentRequest = z.infer<typeof AgentRequestSchema>;
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
