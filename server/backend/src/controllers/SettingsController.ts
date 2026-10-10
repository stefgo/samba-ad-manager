import { FastifyRequest, FastifyReply } from "fastify";
import { CleanupSettingsSchema, firstIssue, type SchedulerStatuses } from "@sadm/shared";
import { SettingsService } from "../services/SettingsService.js";
import { TokenCleanupService } from "../services/TokenCleanupService.js";
import { NotificationCleanupService } from "../services/NotificationCleanupService.js";

export class SettingsController {
    static async getSettings(request: FastifyRequest, reply: FastifyReply) {
        try {
            const settings = SettingsService.getAllSettings();
            return reply.send(settings);
        } catch (e) {
            request.log.error(e);
            return reply
                .code(500)
                .send({ error: "Failed to fetch settings" });
        }
    }

    static async updateSettings(request: FastifyRequest, reply: FastifyReply) {
        // This body is written into config.yaml. The schema checks the known keys and lets
        // unknown ones through -- see CleanupSettingsSchema for why.
        const parsed = CleanupSettingsSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }

        try {
            SettingsService.updateSettings(parsed.data);
            return reply.send({ success: true });
        } catch (e) {
            request.log.error(e);
            return reply
                .code(500)
                .send({ error: "Failed to update settings" });
        }
    }

    static async runInvalidTokenCleanup(request: FastifyRequest, reply: FastifyReply) {
        try {
            const result = await TokenCleanupService.run("manual");
            return reply.send({ success: true, ...result });
        } catch (e) {
            request.log.error(e);
            return reply
                .code(500)
                .send({ error: "Failed to run token cleanup" });
        }
    }

    /** The schedulers the server runs. */
    static async getSchedulerStatus(_request: FastifyRequest, reply: FastifyReply) {
        return reply.send({
            schedulers: {
                "notification-cleanup": NotificationCleanupService.getStatus(),
                "token-cleanup": TokenCleanupService.getStatus(),
            } satisfies SchedulerStatuses,
        });
    }

    static async runNotificationCleanup(_request: FastifyRequest, reply: FastifyReply) {
        try {
            const result = await NotificationCleanupService.run("manual");
            return reply.send({ success: true, ...result });
        } catch (e) {
            _request.log.error(e);
            return reply.code(500).send({ error: "Failed to run notification cleanup" });
        }
    }
}
