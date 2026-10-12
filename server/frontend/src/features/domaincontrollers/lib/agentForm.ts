import { DEFAULT_AGENT_PORT, type DcAgent, type DomainController } from "@sadm/shared";

/** What the dialog asks for to have the server dial an agent: where it listens, and its setup PIN. */
export interface ConnectAgentDraft {
    targetAddress: string;
    registrationSecret: string;
}

/**
 * The address the form starts with: where the domain controller is reached anyway, on the
 * agent's default port. The agent runs in the domain controller's own network, so this is
 * right unless its port was moved.
 */
export const connectAgentDraftFrom = (dc: Pick<DomainController, "address" | "dnsHostName">): ConnectAgentDraft => {
    const host = dc.address || dc.dnsHostName || "";
    return { targetAddress: host ? `${host}:${DEFAULT_AGENT_PORT}` : "", registrationSecret: "" };
};

/** What is sent. The server normalises the address; the PIN goes as it was typed, hyphens and all. */
export const connectAgentInputFrom = (draft: ConnectAgentDraft): { targetAddress: string; registrationSecret: string } => ({
    targetAddress: draft.targetAddress.trim(),
    registrationSecret: draft.registrationSecret.trim(),
});

/** Which field of the form an issue of the request schema belongs to. */
export const connectAgentFieldOf = (path: readonly PropertyKey[]): keyof ConnectAgentDraft | null =>
    path[0] === "targetAddress" ? "targetAddress" : path[0] === "registrationSecret" ? "registrationSecret" : null;

/** How the agent of a domain controller is reached, as a reader is told it. */
export function agentDirection(agent: Pick<DcAgent, "connectionMode" | "targetAddress">): string {
    return agent.connectionMode === "outbound" ? `This server dials it at ${agent.targetAddress ?? "an unknown address"}` : "It dials this server";
}
