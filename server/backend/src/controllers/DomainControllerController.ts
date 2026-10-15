import { FastifyReply, FastifyRequest } from "fastify";
import { AgentRegistrationSchema, ConnectAgentSchema, UpdateAgentSchema, UpdateDomainControllerSchema, firstIssue } from "@sadm/shared";
import { logger } from "../core/logger.js";
import { DcAgentService, type AgentAddressRefusal, type AgentRequestRefusal } from "../services/DcAgentService.js";
import { DomainControllerService } from "../services/DomainControllerService.js";
import { HealthScheduler } from "../services/HealthScheduler.js";

type ById = { Params: { id: string } };

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "No such domain controller" });

const DBCHECK_REFUSALS: Record<Exclude<AgentRequestRefusal, "read-only" | "no-partner">, string> = {
    "no-agent": "This domain controller has no agent to run the check",
    offline: "The agent of this domain controller is not connected",
    unsupported: "The agent of this domain controller does not run the database check",
};

const DBCHECK_FIX_REFUSALS: Record<Exclude<AgentRequestRefusal, "no-partner">, string> = {
    "no-agent": "This domain controller has no agent to fix its database",
    offline: "The agent of this domain controller is not connected",
    unsupported: "The agent of this domain controller is not allowed to fix its database (report.dbcheckAllowFix)",
    "read-only": "Nothing can be changed from this server (directory.readOnly is true)",
};

const REPLICATION_SYNC_REFUSALS: Record<Exclude<AgentRequestRefusal, "read-only">, string> = {
    "no-agent": "This domain controller has no agent to have it replicate",
    offline: "The agent of this domain controller is not connected",
    unsupported: "The agent of this domain controller cannot have it replicate; its image needs a newer agent",
    "no-partner": "This domain controller has no partner to replicate from: it is the only one the directory lists",
};

const ADDRESS_REFUSALS: Record<AgentAddressRefusal, { status: number; error: string }> = {
    "no-agent": { status: 404, error: "This domain controller has no agent" },
    inbound: { status: 409, error: "This agent dials the server itself: there is no address to dial it at" },
};

/**
 * The domain controllers over REST. There is no route that adds or removes one: which
 * domain controllers there are is what the directory lists.
 */
export class DomainControllerController {
    static async list(_request: FastifyRequest, _reply: FastifyReply) {
        return DomainControllerService.list();
    }

    /** Sets where a domain controller is reached, and measures it there at once. */
    static async update(request: FastifyRequest<ById>, reply: FastifyReply) {
        const parsed = UpdateDomainControllerSchema.safeParse(request.body ?? {});
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        const updated = DomainControllerService.setAddress(request.params.id, parsed.data.address || null);
        if (!updated) return notFound(reply);
        // Not waited for: the answer is that the address was taken, and what it leads to arrives on the socket.
        void HealthScheduler.measureNow(updated.id).catch((err) => logger.warn({ err }, "Measuring after an address change failed"));
        return updated;
    }

    /**
     * Measures one domain controller now, replication included. The measurement itself
     * arrives over the socket, like every other one; this answers once it has been taken.
     */
    static async measure(request: FastifyRequest<ById>, reply: FastifyReply) {
        if (!(await HealthScheduler.measureNow(request.params.id))) return notFound(reply);
        return { ok: true };
    }

    /** Measures every domain controller now, replication included. Answers once all have been measured. */
    static async measureAll(_request: FastifyRequest, _reply: FastifyReply) {
        await HealthScheduler.measureAllNow();
        return { ok: true };
    }

    /** Issues the token an agent that dials in registers with. Shown this once. */
    static async issueAgentToken(request: FastifyRequest<ById>, reply: FastifyReply) {
        const created = DcAgentService.issueToken(request.params.id);
        return created ? reply.code(201).send(created) : notFound(reply);
    }

    /** Has the server dial an agent, register it with its setup PIN and connect. Answers once the agent has accepted or refused. */
    static async connectAgent(request: FastifyRequest<ById>, reply: FastifyReply) {
        const parsed = ConnectAgentSchema.safeParse(request.body ?? {});
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        if (!DomainControllerService.get(request.params.id)) return notFound(reply);
        const result = await DcAgentService.connectOutbound(request.params.id, parsed.data.targetAddress, parsed.data.registrationSecret);
        // The agent's refusal, or that nothing answered there. Not a fault of this server, so not a 5xx in its log.
        if (!result.ok) return reply.code(422).send({ error: result.error });
        return DomainControllerService.get(request.params.id);
    }

    /** Sets where the server dials an agent it reaches itself. Answers once it has been dialled there. */
    static async updateAgent(request: FastifyRequest<ById>, reply: FastifyReply) {
        const parsed = UpdateAgentSchema.safeParse(request.body ?? {});
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        if (!DomainControllerService.get(request.params.id)) return notFound(reply);
        const refusal = await DcAgentService.setTargetAddress(request.params.id, parsed.data.targetAddress, request.user?.username ?? null);
        if (refusal) return reply.code(ADDRESS_REFUSALS[refusal].status).send({ error: ADDRESS_REFUSALS[refusal].error });
        return DomainControllerService.get(request.params.id);
    }

    static async removeAgent(request: FastifyRequest<ById>, reply: FastifyReply) {
        if (!DomainControllerService.get(request.params.id)) return notFound(reply);
        if (!DcAgentService.remove(request.params.id, request.user?.username ?? null)) {
            return reply.code(404).send({ error: "This domain controller has no agent" });
        }
        return { ok: true };
    }

    /**
     * Has the domain controller's agent run the database check now. Answers once the agent
     * was asked: the check takes minutes, and its result arrives over the socket.
     */
    static async runDbcheck(request: FastifyRequest<ById>, reply: FastifyReply) {
        if (!DomainControllerService.get(request.params.id)) return notFound(reply);
        const refusal = DcAgentService.requestDbcheck(request.params.id);
        if (refusal) return reply.code(409).send({ error: DBCHECK_REFUSALS[refusal] });
        return reply.code(202).send({ ok: true });
    }

    /**
     * Has the domain controller's agent fix what its database check finds, and check again.
     * Answers once the agent was asked: the result arrives over the socket, with the check.
     */
    static async fixDbcheck(request: FastifyRequest<ById>, reply: FastifyReply) {
        if (!DomainControllerService.get(request.params.id)) return notFound(reply);
        const refusal = DcAgentService.requestDbcheckFix(request.params.id, request.user?.username ?? null);
        if (refusal) return reply.code(refusal === "read-only" ? 403 : 409).send({ error: DBCHECK_FIX_REFUSALS[refusal] });
        return reply.code(202).send({ ok: true });
    }

    /**
     * Has the domain controller's agent replicate now from every inbound partner. Answers once
     * the agent was asked: the links are measured again when it reports.
     */
    static async syncReplication(request: FastifyRequest<ById>, reply: FastifyReply) {
        if (!DomainControllerService.get(request.params.id)) return notFound(reply);
        const refusal = DcAgentService.requestReplicationSync(request.params.id, request.user?.username ?? null);
        if (refusal) return reply.code(409).send({ error: REPLICATION_SYNC_REFUSALS[refusal] });
        return reply.code(202).send({ ok: true });
    }

    /**
     * `POST /api/v1/register`: an agent registering for its domain controller. No session --
     * the caller is an agent, and the registration token is all it has. The token names one
     * domain controller, and it is good for that one only.
     */
    static async registerAgent(request: FastifyRequest, reply: FastifyReply) {
        const parsed = AgentRegistrationSchema.safeParse(request.body ?? {});
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        const result = DcAgentService.registerInbound(parsed.data);
        if (!result.ok) return reply.code(result.status).send({ error: result.error });
        return { token: result.token, clientId: result.clientId };
    }
}
