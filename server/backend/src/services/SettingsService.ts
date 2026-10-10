import type { AppConfig } from "../config/AppConfig.js";
import { appConfig, updateConfig } from "../config/AppConfig.js";
import { logger } from "@sadm/shared/node";
import { NotificationCleanupService } from "./NotificationCleanupService.js";
import { TokenCleanupService } from "./TokenCleanupService.js";

const TOKEN_CLEANUP_KEYS = new Set([
    "token_retention_days",
    "token_cleanup_interval_hours",
]);

const NOTIFICATION_CLEANUP_KEYS = new Set([
    "notification_retention_days",
    "notification_retention_count",
    "notification_cleanup_interval_hours",
]);

/**
 * Reads and writes the operator-facing part of `config.yaml`: the `settings` block. The
 * remaining keys in that file -- `security`, `jwtSecret`, the OIDC credentials -- are startup
 * configuration and deliberately have no API surface.
 */
export class SettingsService {
    /**
     * One setting as a string. The known keys arrive as strings from AppConfigSchema; a key
     * added by hand is whatever YAML made of it, so a number or boolean is levelled out here
     * and anything structured is not a value to coerce.
     */
    static getSetting(key: string): string | null {
        try {
            const value = appConfig.settings[key];
            if (value === undefined || value === null || value === "") return null;
            if (typeof value === "string") return value;
            if (typeof value === "number" || typeof value === "boolean") {
                return String(value);
            }
            logger.warn({ key }, "Setting is not a scalar value, ignoring it");
            return null;
        } catch (e) {
            logger.error({ err: e, key }, "Failed to get setting");
            return null;
        }
    }

    /**
     * Everything the settings page shows. `security` used to be returned alongside, and the
     * page sent it back unchanged on every save; it is config.yaml-only now.
     */
    static getAllSettings(): Record<string, unknown> {
        try {
            return { ...appConfig.settings };
        } catch (e) {
            logger.error({ err: e }, "Failed to get all settings");
            return {};
        }
    }

    /**
     * Merges already validated settings into the `settings` block. `security` never arrives
     * here: CleanupSettingsSchema rejects it.
     */
    static updateSettings(settings: Record<string, unknown>): void {
        try {
            const previousSettings = { ...appConfig.settings };
            const newSettings = {
                ...appConfig.settings,
                ...(settings as Record<string, string>),
            };

            const updates: Partial<AppConfig> = { settings: newSettings };

            updateConfig(updates);

            const notificationCleanupChanged = [...NOTIFICATION_CLEANUP_KEYS].some(
                (key) => previousSettings[key] !== newSettings[key],
            );
            if (notificationCleanupChanged) {
                NotificationCleanupService.restartScheduler();
            }

            const tokenCleanupChanged = [...TOKEN_CLEANUP_KEYS].some(
                (key) => previousSettings[key] !== newSettings[key],
            );
            if (tokenCleanupChanged) {
                TokenCleanupService.restartScheduler();
            }
        } catch (e) {
            logger.error({ err: e }, "Failed to update settings");
            throw e;
        }
    }
}
