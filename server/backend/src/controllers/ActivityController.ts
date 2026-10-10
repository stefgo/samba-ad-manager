import { FastifyReply, FastifyRequest } from "fastify";
import { MarkActivitySeenSchema, firstIssue } from "@sadm/shared";
import { ActivityService } from "../services/ActivityService.js";

export class ActivityController {
    static async list(request: FastifyRequest, _reply: FastifyReply) {
        return ActivityService.list(request.user.id);
    }

    static async markManySeen(request: FastifyRequest, reply: FastifyReply) {
        const parsed = MarkActivitySeenSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }
        ActivityService.markManySeen(parsed.data.ids, request.user.id);
        return { ok: true };
    }

    static async deleteAll(_request: FastifyRequest, _reply: FastifyReply) {
        ActivityService.deleteAll();
        return { ok: true };
    }
}
