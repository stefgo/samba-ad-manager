import { FastifyReply, FastifyRequest } from "fastify";
import { ClientRepository } from "../repositories/ClientRepository.js";
import { AgentRpc, AgentRpcError, agentRpcStatus } from "../services/AgentRpc.js";
import { DcHealthService } from "../services/DcHealthService.js";
import { DomainEventService } from "../services/DomainEventService.js";

type ClientParams = { Params: { clientId: string } };

/** Answers a failed request to an agent with the status and the reason it gave. */
export function sendAgentError(reply: FastifyReply, err: unknown) {
    if (err instanceof AgentRpcError) {
        return reply.code(agentRpcStatus(err)).send({ error: err.message, code: err.code });
    }
    throw err;
}

export class DcHealthController {
    /** The thresholds the findings are judged by, so the dashboard judges by the same. */
    static async options(_request: FastifyRequest, _reply: FastifyReply) {
        return DomainEventService.options();
    }

    /** The last measurement of every client that has one. */
    static async list(_request: FastifyRequest, _reply: FastifyReply) {
        return DcHealthService.getAll();
    }

    /**
     * Asks the agent to measure now. The measurement itself arrives over the socket, like
     * every other one; this only says whether the agent took the request.
     */
    static async refresh(request: FastifyRequest<ClientParams>, reply: FastifyReply) {
        const { clientId } = request.params;
        if (!ClientRepository.findById(clientId)) {
            return reply.code(404).send({ error: "Client not found" });
        }
        try {
            await AgentRpc.request(clientId, "health.refresh", {});
            return { ok: true };
        } catch (err) {
            return sendAgentError(reply, err);
        }
    }

    /** Runs the database check on the client's domain controller and answers with what it found. */
    static async dbcheck(request: FastifyRequest<ClientParams>, reply: FastifyReply) {
        const { clientId } = request.params;
        if (!ClientRepository.findById(clientId)) {
            return reply.code(404).send({ error: "Client not found" });
        }
        try {
            return await AgentRpc.request(clientId, "health.dbcheck", {});
        } catch (err) {
            return sendAgentError(reply, err);
        }
    }
}
