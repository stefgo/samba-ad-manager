import { AGENT_CAPABILITIES, type DcAgent } from "@sadm/shared";

/** Whether "Replicate now" is offered, and why it cannot be clicked where it is offered and cannot. */
export type ReplicationSyncOffer = { offered: false } | { offered: true; disabledReason: string | null };

/**
 * When a domain controller can be had to replicate from here: through its agent, so not for
 * one without. Where the agent stands in the way -- it predates the request, or it is away --
 * or the domain controller is the only one there is, it is offered and says why not, so that
 * it can be found. Not a change to the directory: `directory.readOnly` does not hold it back.
 */
export function replicationSyncOffer(
    agent: Pick<DcAgent, "capabilities" | "connected"> | null,
    controllers: number,
): ReplicationSyncOffer {
    if (!agent) return { offered: false };
    if (controllers <= 1) return { offered: true, disabledReason: "This domain controller has no partner to replicate from" };
    if (!agent.capabilities.includes(AGENT_CAPABILITIES.REPLICATION_SYNC)) {
        return { offered: true, disabledReason: "The agent is too old for this: the domain controller's image needs a newer one" };
    }
    if (!agent.connected) return { offered: true, disabledReason: "The agent is not connected" };
    return { offered: true, disabledReason: null };
}
