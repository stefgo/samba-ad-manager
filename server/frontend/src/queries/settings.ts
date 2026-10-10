import { ManualRunResultSchema, SettingsResponseSchema } from "@sadm/shared";
import { api } from "../lib/api";

/**
 * The requests of the settings page. Deliberately no cache entries: the settings are loaded
 * once into the form's draft, and an entry that is read again behind the form would
 * overwrite what is typed and not yet saved. The scheduler status below the fields is an
 * entry (`scheduler.ts`), and follows the socket.
 */

/** The settings block as the fields hold it: every value a string, whatever it means. */
export type SettingsValues = Record<string, string>;

/**
 * The settings block of config.yaml. A value an operator wrote by hand is a number there
 * and a string once the UI has saved it, so everything is read as the string a field shows.
 */
export async function loadSettings(): Promise<SettingsValues> {
    const settings = await api.get("/api/v1/settings/cleanup", SettingsResponseSchema, {
        fallback: "Failed to fetch settings",
    });
    return Object.fromEntries(
        Object.entries(settings)
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key, value]) => [key, String(value)]),
    );
}

/**
 * Saves the keys it is given; the server merges them into the stored block and names the
 * offending field when it refuses.
 */
export const saveSettings = (values: SettingsValues) =>
    api.put("/api/v1/settings/cleanup", values, undefined, { fallback: "Failed to save settings" });

/**
 * Starts a maintenance job now and returns what it reports. The scheduler's status follows
 * as `SCHEDULER_STATUS_UPDATE`.
 */
export const runCleanup = (job: "invalid-tokens" | "notifications") =>
    api.post(`/api/v1/settings/cleanup/${job}`, undefined, ManualRunResultSchema, {
        fallback: "The server refused to start the job",
    });
