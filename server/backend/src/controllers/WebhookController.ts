import { FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "crypto";
import { WebhookInputSchema, firstIssue } from "@sadm/shared";
import { WebhookRepository } from "../repositories/WebhookRepository.js";
import { WebhookService } from "../services/WebhookService.js";

/**
 * The webhooks events are reported to. Headers go back to the editor in the clear: they are
 * edited there, and every user of this server may see and change everything else too.
 */
export class WebhookController {
    static async list() {
        return WebhookRepository.findAll();
    }

    static async create(request: FastifyRequest, reply: FastifyReply) {
        const parsed = WebhookInputSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }
        const id = randomUUID();
        WebhookRepository.create(id, parsed.data);
        return reply.code(201).send(WebhookRepository.findById(id));
    }

    static async update(request: FastifyRequest, reply: FastifyReply) {
        const { webhookId } = request.params as { webhookId: string };
        const parsed = WebhookInputSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }
        const { changes } = WebhookRepository.update(webhookId, parsed.data);
        if (changes === 0) {
            return reply.code(404).send({ error: "Webhook not found" });
        }
        return WebhookRepository.findById(webhookId);
    }

    static async delete(request: FastifyRequest, reply: FastifyReply) {
        const { webhookId } = request.params as { webhookId: string };
        const { changes } = WebhookRepository.delete(webhookId);
        if (changes === 0) {
            return reply.code(404).send({ error: "Webhook not found" });
        }
        return { success: true };
    }

    /**
     * Sends the sample event with the webhook as the editor holds it, so a target can be tried
     * before it is saved. A refusal by the target is still a 200: the test ran, and its result
     * says how it went.
     */
    static async test(request: FastifyRequest, reply: FastifyReply) {
        const parsed = WebhookInputSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }
        return WebhookService.test(parsed.data);
    }
}
