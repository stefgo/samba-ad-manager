import type { AgentErrorCode } from "@sadm/shared";

/**
 * A refusal with its reason, as the server is told it. Anything else thrown while an action
 * runs is reported as `failed`. A module of its own: the services throw it and
 * `AgentRequests` catches it, and neither should import the other for that.
 */
export class AgentActionError extends Error {
    readonly code: AgentErrorCode;

    constructor(code: AgentErrorCode, message: string) {
        super(message);
        this.name = "AgentActionError";
        this.code = code;
    }
}
