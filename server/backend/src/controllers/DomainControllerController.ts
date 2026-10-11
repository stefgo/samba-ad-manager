import { FastifyReply, FastifyRequest } from "fastify";
import { DbcheckReportSchema, UpdateDomainControllerSchema, firstIssue } from "@sadm/shared";
import { logger } from "../core/logger.js";
import { DcHealthService } from "../services/DcHealthService.js";
import { DomainControllerService } from "../services/DomainControllerService.js";
import { HealthScheduler } from "../services/HealthScheduler.js";

type ById = { Params: { id: string } };

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "No such domain controller" });

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

    /** Issues the token the domain controller's database check is reported with. Shown this once. */
    static async issueReportToken(request: FastifyRequest<ById>, reply: FastifyReply) {
        const created = DomainControllerService.issueReportToken(request.params.id);
        return created ? reply.code(201).send(created) : notFound(reply);
    }

    static async revokeReportToken(request: FastifyRequest<ById>, reply: FastifyReply) {
        return DomainControllerService.revokeReportToken(request.params.id) ? { ok: true } : notFound(reply);
    }

    /**
     * `POST /api/v1/dbcheck/report`: a domain controller reporting a run of its database
     * check. No session -- the caller is a script, and the token in its `Authorization`
     * header is all it has. The token names one domain controller, and a report is taken
     * for that one only: what it says of itself has to match.
     */
    static async reportDbcheck(request: FastifyRequest, reply: FastifyReply) {
        const header = request.headers.authorization ?? "";
        const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
        const dc = token ? DomainControllerService.byReportToken(token) : null;
        if (!dc) return reply.code(401).send({ error: "Not a report token of a domain controller" });

        const parsed = DbcheckReportSchema.safeParse(request.body ?? {});
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        if (parsed.data.dcId.toLowerCase() !== dc.id.toLowerCase()) {
            logger.warn({ dc: dc.name, reported: parsed.data.dcId }, "A database check was reported with another domain controller's token");
            return reply.code(403).send({ error: `This token belongs to ${dc.name}, which is not the domain controller reporting` });
        }

        DcHealthService.storeDbcheck({ ...parsed.data, dcId: dc.id });
        return { ok: true };
    }
}
