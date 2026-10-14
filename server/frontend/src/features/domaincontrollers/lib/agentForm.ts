import { DEFAULT_AGENT_PORT, type ConnectionMode, type DcAgent, type DomainController } from "@sadm/shared";

/** The side the add-agent flow opens on: the one that leaves no port open on a domain controller. */
export const DEFAULT_CONNECTION_MODE: ConnectionMode = "inbound";

/** What the flow asks for to have the server dial an agent: where it listens, and its setup PIN. */
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

/**
 * Whether there is anything about an agent to edit. Only where the server dials it is its
 * to say; an agent that dials in is described by what it says of itself.
 */
export const canEditAgent = (agent: Pick<DcAgent, "connectionMode">): boolean => agent.connectionMode === "outbound";

/** What the edit dialog holds: where the server dials the agent. */
export interface AgentAddressDraft {
    targetAddress: string;
}

export const agentAddressDraftFrom = (agent: Pick<DcAgent, "targetAddress">): AgentAddressDraft => ({
    targetAddress: agent.targetAddress ?? "",
});

/** What is sent. The server normalises the address. */
export const agentAddressInputFrom = (draft: AgentAddressDraft): { targetAddress: string } => ({
    targetAddress: draft.targetAddress.trim(),
});

export const agentAddressFieldOf = (path: readonly PropertyKey[]): keyof AgentAddressDraft | null =>
    path[0] === "targetAddress" ? "targetAddress" : null;

/** How the agent of a domain controller is reached, as a reader is told it. */
export function agentDirection(agent: Pick<DcAgent, "connectionMode" | "targetAddress">): string {
    return agent.connectionMode === "outbound" ? `This server dials it at ${agent.targetAddress ?? "an unknown address"}` : "It dials this server";
}
