import { FastifyReply, FastifyRequest } from "fastify";
import { StatusService } from "../services/StatusService.js";

export class StatusController {
    /**
     * The dashboard's verdict and findings, for a reader that is not a browser. Never cached:
     * a reader that polls must see what is now. One that cannot be put together is a 503
     * with the verdict `unknown`, not a stale "healthy".
     */
    static async get(request: FastifyRequest, reply: FastifyReply) {
        reply.header("Cache-Control", "no-store");
        try {
            return StatusService.report();
        } catch (err) {
            request.log.error({ err }, "Status report failed");
            return reply.code(503).send({ status: "unknown" });
        }
    }
}
