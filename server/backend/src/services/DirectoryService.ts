import {
    AGENT_CAPABILITIES,
    type ActivityKind,
    type AgentAction,
    type AgentActionPayload,
    type AgentActionResult,
} from "@sadm/shared";
import { ClientRepository } from "../repositories/ClientRepository.js";
import { ActivityService } from "./ActivityService.js";
import { AgentRpc, AgentRpcError } from "./AgentRpc.js";
import { DcHealthService } from "./DcHealthService.js";
import { ProxyService } from "./ProxyService.js";

/** What a change answers with: the object it was made to, as the directory named it. */
interface Changed {
    name: string;
    dn: string;
    type: string;
    guid?: string;
}

/** Who asked for a change, for the record of it. */
export interface Actor {
    username: string;
}

/**
 * The directory, reached through whichever agent is best placed to answer.
 *
 * Every domain controller holds the whole directory, so any connected agent can read it and
 * -- replication carries a change to the others -- write it. The PDC emulator is asked
 * first: it is where password changes are authoritative and where other tools write by
 * default, so what is read there is what was last written. Without it, any other will do.
 */
export class DirectoryService {
    private static clientLabel(clientId: string): string {
        const client = ClientRepository.findById(clientId);
        return client?.display_name || client?.hostname || clientId;
    }

    /**
     * The client to send a request to: the one asked for, or else the PDC emulator's agent,
     * or else the first one that can. An `offline` refusal when none is connected that can.
     */
    static pick(write: boolean, preferred?: string | null): string {
        const capability = write ? AGENT_CAPABILITIES.DIRECTORY_WRITE : AGENT_CAPABILITIES.DIRECTORY;
        const able = ProxyService.getConnectedClientIds().filter((id) => ProxyService.hasCapability(id, capability));
        if (preferred) {
            if (able.includes(preferred)) return preferred;
            throw new AgentRpcError("offline", "That domain controller's agent is not connected, or does not serve the directory");
        }
        if (able.length === 0) {
            const readable = ProxyService.getConnectedClientIds().some((id) =>
                ProxyService.hasCapability(id, AGENT_CAPABILITIES.DIRECTORY),
            );
            throw new AgentRpcError(
                write && readable ? "forbidden" : "offline",
                write && readable
                    ? "Every connected agent is read-only (directory.readOnly)"
                    : "No agent that serves the directory is connected",
            );
        }
        const pdc = able.find((id) => {
            const health = DcHealthService.get(id);
            const name = health?.identity?.name;
            return !!name && health?.domain?.fsmo?.pdc?.toUpperCase() === name.toUpperCase();
        });
        return pdc ?? [...able].sort((a, b) => this.clientLabel(a).localeCompare(this.clientLabel(b)))[0];
    }

    /** What the dashboard needs to know before it offers anything: can the directory be read, and changed, and through whom. */
    static status(): { available: boolean; writable: boolean; via: { clientId: string; name: string } | null } {
        const picked = (write: boolean): string | null => {
            try {
                return this.pick(write);
            } catch {
                return null;
            }
        };
        const clientId = picked(false);
        if (!clientId) return { available: false, writable: false, via: null };
        return { available: true, writable: picked(true) !== null, via: { clientId, name: this.clientLabel(clientId) } };
    }

    /** A question about the directory. */
    static read<A extends AgentAction>(
        action: A,
        payload: AgentActionPayload<A>,
        preferred?: string | null,
    ): Promise<AgentActionResult<A>> {
        return AgentRpc.request(this.pick(false, preferred), action, payload);
    }

    /**
     * A change to the directory, recorded once it is made: who made it, to which object,
     * through which domain controller. A change the agent refuses leaves no record -- it
     * did not happen.
     */
    static async change<A extends AgentAction>(
        actor: Actor,
        action: A,
        payload: AgentActionPayload<A>,
        kind: ActivityKind,
        facts: Record<string, unknown> = {},
    ): Promise<AgentActionResult<A>> {
        const clientId = this.pick(true);
        const result = await AgentRpc.request(clientId, action, payload);
        const changed = result as unknown as Changed;
        ActivityService.record({
            kind,
            level: "info",
            clientId,
            subject: { dn: changed.dn, name: changed.name },
            data: {
                actor: actor.username,
                name: changed.name,
                type: changed.type,
                clientName: this.clientLabel(clientId),
                ...facts,
            },
        });
        return result;
    }
}
