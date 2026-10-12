import { z } from "zod";
import { AGENT_EVENTS, DbcheckReportSchema, type DbcheckReport } from "@sadm/shared";
import { config } from "../core/Config.js";
import { Connection } from "../core/Connection.js";
import { readJsonFile, writeJsonFile } from "../core/DataStore.js";
import { logger } from "../core/logger.js";
import { runSambaHelper } from "./SambaHelper.js";

/**
 * Samba's database check, read-only: on this agent's own schedule, and whenever the server
 * asks. It walks every object of every partition the domain controller holds, so it runs
 * once a day by default and never twice at a time.
 *
 * The last result is kept on disk with whether the server has it. A check that finished
 * while the server was away is sent on the next connection instead of being run again.
 */

const LAST_FILE = "dbcheck-last.json";
const StoredSchema = z.object({ report: DbcheckReportSchema, sent: z.boolean() });

/** How often the schedule is looked at. */
const DUE_CHECK_MS = 10 * 60_000;
/** How long after the agent started the first check may run: Samba may be starting as well. */
const FIRST_CHECK_AFTER_MS = 2 * 60_000;

/** Whether a check is due: none has run yet, or the last one is older than the interval. */
export function isDbcheckDue(lastCheckedAt: string | null, intervalHours: number, now: number): boolean {
    if (intervalHours <= 0) return false;
    if (!lastCheckedAt) return true;
    const last = Date.parse(lastCheckedAt);
    return Number.isNaN(last) || now - last >= intervalHours * 3600_000;
}

export class DbcheckService {
    private static running: Promise<void> | null = null;
    private static stored: z.infer<typeof StoredSchema> | null = null;

    static start(): void {
        const parsed = StoredSchema.safeParse(readJsonFile(LAST_FILE));
        this.stored = parsed.success ? parsed.data : null;

        Connection.onServerMessage(AGENT_EVENTS.REQUEST_DBCHECK, () => void this.run("the server asked"));
        Connection.onConnected(() => this.sendStored());
        setTimeout(() => this.runIfDue(), FIRST_CHECK_AFTER_MS).unref();
        setInterval(() => this.runIfDue(), DUE_CHECK_MS).unref();
    }

    /** When the last check finished, for the status page. */
    static lastCheckedAt(): string | null {
        return this.stored?.report.checkedAt ?? null;
    }

    private static runIfDue(): void {
        if (isDbcheckDue(this.lastCheckedAt(), config.report.dbcheckIntervalHours, Date.now())) void this.run("it is due");
    }

    private static keep(report: DbcheckReport, sent: boolean): void {
        this.stored = { report, sent };
        writeJsonFile(LAST_FILE, this.stored);
    }

    private static sendStored(): void {
        if (!this.stored || this.stored.sent) return;
        if (Connection.send(AGENT_EVENTS.DBCHECK_REPORT, this.stored.report)) this.keep(this.stored.report, true);
    }

    /** Runs the check and reports it. A check that is already running is the one a second caller gets. */
    static run(why: string): Promise<void> {
        if (this.running) return this.running;
        const running = (async () => {
            logger.info(`Running the database check: ${why}`);
            const started = Date.now();
            let report: DbcheckReport;
            try {
                const result = await runSambaHelper("dbcheck");
                report = { checkedAt: new Date().toISOString(), errors: result.errors, durationMs: result.durationMs };
                logger.info(`The database check counted ${result.errors} error(s) in ${Math.round(result.durationMs / 1000)} s`);
            } catch (err) {
                // That the check could not be run is what is reported.
                const error = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
                report = { checkedAt: new Date().toISOString(), errors: null, durationMs: Date.now() - started, error };
                logger.error(`The database check could not be run: ${error}`);
            }
            this.keep(report, false);
            this.sendStored();
        })();
        this.running = running;
        void running.finally(() => {
            if (this.running === running) this.running = null;
        });
        return running;
    }
}
