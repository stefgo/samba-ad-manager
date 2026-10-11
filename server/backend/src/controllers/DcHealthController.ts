import { FastifyReply, FastifyRequest } from "fastify";
import { DcHealthService } from "../services/DcHealthService.js";
import { DnsServerHealthService } from "../services/DnsServerHealthService.js";
import { DomainEventService } from "../services/DomainEventService.js";

export class DcHealthController {
    /** The thresholds the findings are judged by, so the dashboard judges by the same. */
    static async options(_request: FastifyRequest, _reply: FastifyReply) {
        return DomainEventService.options();
    }

    /** The last measurement of every domain controller that has one. */
    static async list(_request: FastifyRequest, _reply: FastifyReply) {
        return DcHealthService.getAll();
    }

    /** The name servers of the domain that are no domain controllers, as last asked. */
    static async nameServers(_request: FastifyRequest, _reply: FastifyReply) {
        return DnsServerHealthService.getAll();
    }
}
