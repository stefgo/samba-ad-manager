import { appConfig } from "../config/AppConfig.js";
import { ActivityRepository } from "../repositories/ActivityRepository.js";
import { ScheduledJob } from "./ScheduledJob.js";
import { logger } from "../core/logger.js";
import type { SchedulerStatus, SchedulerTrigger } from "@sadm/shared";

export interface NotificationCleanupResult {
    removed: number;
}

function readConfig() {
    const ttlDays = parseInt(appConfig.settings.notification_retention_days ?? "90", 10);
    const minKeep = parseInt(appConfig.settings.notification_retention_count ?? "500", 10);
    const intervalHours = parseInt(appConfig.settings.notification_cleanup_interval_hours ?? "24", 10);
    return {
        ttlDays: Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 90,
        minKeep: Number.isFinite(minKeep) && minKeep >= 0 ? minKeep : 500,
        intervalHours: Number.isFinite(intervalHours) ? intervalHours : 24,
    };
}

/**
 * Retention for the activity list. Named after the notifications it used to clean, and
 * deliberately left that way: the settings it reads (`notification_retention_*`) are stored
 * values.
 */
const job = new ScheduledJob({
    id: "notification-cleanup",
    intervalMs: () => readConfig().intervalHours * 60 * 60 * 1000,
});

export class NotificationCleanupService {
    static run(trigger: SchedulerTrigger = "schedule"): Promise<NotificationCleanupResult> {
        return job.run(trigger, () => {
            const { ttlDays, minKeep } = readConfig();
            const removed = ActivityRepository.cleanupOld(ttlDays, minKeep);
            logger.info({ removed, ttlDays, minKeep }, "Notification cleanup completed");
            return { removed };
        });
    }

    static startScheduler(): void {
        job.start(() => this.run("schedule"));
    }

    static stopScheduler(): void {
        job.stop();
    }

    static restartScheduler(): void {
        this.startScheduler();
    }

    static getStatus(): SchedulerStatus<"notification-cleanup"> {
        return job.status();
    }
}
