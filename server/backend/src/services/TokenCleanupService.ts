import { appConfig } from "../config/AppConfig.js";
import { TokenRepository } from "../repositories/TokenRepository.js";
import { ScheduledJob } from "./ScheduledJob.js";
import { logger } from "@sadm/shared/node";
import type { SchedulerStatus, SchedulerTrigger } from "@sadm/shared";

export interface TokenCleanupResult {
    removed: number;
}

function readConfig() {
    const ttlDays = parseInt(appConfig.settings.token_retention_days ?? "30", 10);
    const intervalHours = parseInt(appConfig.settings.token_cleanup_interval_hours ?? "24", 10);
    return {
        ttlDays: Number.isFinite(ttlDays) && ttlDays >= 0 ? ttlDays : 30,
        intervalHours: Number.isFinite(intervalHours) ? intervalHours : 24,
    };
}

const job = new ScheduledJob({
    id: "token-cleanup",
    intervalMs: () => readConfig().intervalHours * 60 * 60 * 1000,
});

export class TokenCleanupService {
    /**
     * Removes registration tokens that have been invalid -- used or expired -- for longer
     * than `token_retention_days`.
     */
    static run(trigger: SchedulerTrigger = "schedule"): Promise<TokenCleanupResult> {
        return job.run(trigger, () => {
            const { ttlDays } = readConfig();
            const removed = TokenRepository.cleanupInvalidTokens(ttlDays);
            logger.info({ removed, ttlDays }, "Invalid token cleanup completed");
            return { removed };
        });
    }

    /** Starts the periodic scheduler; an interval of 0 disables it. */
    static startScheduler(): void {
        job.start(() => this.run("schedule"));
    }

    static stopScheduler(): void {
        job.stop();
    }

    static restartScheduler(): void {
        this.startScheduler();
    }

    static getStatus(): SchedulerStatus<"token-cleanup"> {
        return job.status();
    }
}
