import { z } from "zod";
import { AGENT_EVENTS, DbcheckFixRequestSchema, DbcheckReportSchema, type DbcheckReport } from "@sadm/shared";
import { config } from "../core/Config.js";
import { Connection } from "../core/Connection.js";
import { readJsonFile, writeJsonFile } from "../core/DataStore.js";
import { logger } from "../core/logger.js";
import { runSambaHelper } from "./SambaHelper.js";
import { SeriesSchema, afterAttempt, startSeries, waitBeforeResuming, type Series } from "./series.js";

/**
 * Samba's database check: on this agent's own schedule, and whenever the server asks. It
 * walks every object of every partition the domain controller holds, so it runs once a day
 * by default and never twice at a time.
 *
 * The check itself only reads. Where the operator allowed it (`report.dbcheckAllowFix`) the
 * server may also have it fix what it finds -- in one transaction, as `samba-tool dbcheck
 * --fix --yes` does -- and a check follows right after, so what is reported is what is left.
 * A check and a fix never run at the same time.
 *
 * A fix that leaves errors, or fails, is tried again as often and as far apart as the
 * request says; every check after a fix carries where that stands (`series`). The operation
 * is kept on disk, so a restart carries it on.
 *
 * The last result is kept on disk with whether the server has it. A check that finished
 * while the server was away is sent on the next connection instead of being run again.
 */

const LAST_FILE = "dbcheck-last.json";
const SERIES_FILE = "dbcheck-fix-series.json";
const StoredSchema = z.object({ report: DbcheckReportSchema, sent: z.boolean() });

/** How often the schedule is looked at. */
const DUE_CHECK_MS = 10 * 60_000;
/** How long after the agent started the first check may run: Samba may be starting as well. */
const FIRST_CHECK_AFTER_MS = 2 * 60_000;

type DbcheckFix = NonNullable<DbcheckReport["fix"]>;

/** What can run: a check, or a fix with the check that follows it. */
export type DbcheckJob = "check" | "fix";

/**
 * What a request meets: `start` when nothing runs, `join` when what runs already covers it
 * -- a fix ends with a check, so it covers both --, and `after` for a fix asked for while a
 * check runs: it is not covered and waits for it.
 */
export function planDbcheckJob(running: DbcheckJob | null, requested: DbcheckJob): "start" | "join" | "after" {
    if (!running) return "start";
    if (running === "fix" || requested === "check") return "join";
    return "after";
}

/** Whether a check is due: none has run yet, or the last one is older than the interval. */
export function isDbcheckDue(lastCheckedAt: string | null, intervalHours: number, now: number): boolean {
    if (intervalHours <= 0) return false;
    if (!lastCheckedAt) return true;
    const last = Date.parse(lastCheckedAt);
    return Number.isNaN(last) || now - last >= intervalHours * 3600_000;
}

/**
 * Whether a fix left nothing to try again: it ran, and the check after it counted no error.
 * A fix that failed, one that left errors, and one whose check could not be run are tried
 * again -- a second run of Samba's fix often settles what the first one uncovered.
 */
export const fixSucceeded = (report: Pick<DbcheckReport, "errors" | "fix">): boolean =>
    report.fix?.errorsFound !== null && report.fix?.errorsFound !== undefined && report.errors === 0;

/** What the history of an operation keeps of one fix. */
export const fixEntry = (report: Pick<DbcheckReport, "errors" | "fix">): Record<string, unknown> => ({
    errorsFound: report.fix?.errorsFound ?? null,
    errorsRemaining: report.errors,
    ...(report.fix?.error ? { error: report.fix.error } : {}),
});

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 2000);

export class DbcheckService {
    private static running: { job: DbcheckJob; done: Promise<void> } | null = null;
    /** A fix asked for while a check runs. A second request for it is the same fix. */
    private static queuedFix: Promise<void> | null = null;
    private static stored: z.infer<typeof StoredSchema> | null = null;
    /** The fix under way, from the request until its last attempt has been reported. */
    private static series: Series | null = null;
    private static nextAttempt: NodeJS.Timeout | null = null;

    static start(): void {
        const parsed = StoredSchema.safeParse(readJsonFile(LAST_FILE));
        this.stored = parsed.success ? parsed.data : null;

        Connection.onServerMessage(AGENT_EVENTS.REQUEST_DBCHECK, () => void this.run("the server asked"));
        Connection.onServerMessage(AGENT_EVENTS.REQUEST_DBCHECK_FIX, (payload) => this.requested(payload));
        Connection.onConnected(() => this.sendStored());
        this.resume();
        setTimeout(() => this.runIfDue(), FIRST_CHECK_AFTER_MS).unref();
        setInterval(() => this.runIfDue(), DUE_CHECK_MS).unref();
    }

    /** A request to fix: the start of an operation, or part of the one under way. */
    private static requested(payload: unknown): void {
        // The server does not ask an agent that does not name the capability. One that does anyway is not obeyed.
        if (!config.report.dbcheckAllowFix) {
            logger.warn("The server asked to fix the database, and report.dbcheckAllowFix does not allow it");
            return;
        }
        const request = DbcheckFixRequestSchema.safeParse(payload ?? {});
        if (!request.success) {
            logger.warn({ issues: request.error.issues }, "The server asked to fix the database with a request that is not one");
            return;
        }
        if (this.series) {
            logger.info("The server asked to fix the database while a fix is under way: it is the same fix");
            return;
        }
        this.series = startSeries(request.data);
        this.keepSeries();
        void this.attempt("the server asked");
    }

    /** Carries on with a fix the agent was in when it stopped -- where its operator still allows it. */
    private static resume(): void {
        const parsed = SeriesSchema.nullable().safeParse(readJsonFile(SERIES_FILE));
        if (!parsed.success || !parsed.data) return;
        if (!config.report.dbcheckAllowFix) {
            logger.warn("A fix of the database was under way, and report.dbcheckAllowFix no longer allows it: it is dropped");
            writeJsonFile(SERIES_FILE, null);
            return;
        }
        this.series = parsed.data;
        const wait = waitBeforeResuming(parsed.data, Date.now());
        logger.info(`Carrying on with a fix of the database, attempt ${parsed.data.attempt} of ${parsed.data.of}, in ${Math.round(wait / 1000)} s`);
        this.scheduleAttempt(wait);
    }

    private static keepSeries(): void {
        writeJsonFile(SERIES_FILE, this.series);
    }

    private static scheduleAttempt(wait: number): void {
        if (this.nextAttempt) clearTimeout(this.nextAttempt);
        this.nextAttempt = setTimeout(() => {
            this.nextAttempt = null;
            void this.attempt("it is tried again");
        }, wait);
        this.nextAttempt.unref();
    }

    /** One attempt of the fix under way: fix, check, and report where the operation stands. */
    private static attempt(why: string): Promise<void> {
        const series = this.series;
        if (!series) return Promise.resolve();
        this.series = { ...series, nextAttemptAt: null };
        this.keepSeries();
        return this.fix(`${why}, attempt ${series.attempt} of ${series.of}`, (report) => {
            const step = afterAttempt(this.series ?? series, fixSucceeded(report), fixEntry(report), Date.now());
            this.series = step.series;
            this.keepSeries();
            if (step.series) this.scheduleAttempt(waitBeforeResuming(step.series, Date.now()));
            return { ...report, series: step.state };
        });
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

    /** Runs the check and reports it. What already runs covers a second caller. */
    static run(why: string): Promise<void> {
        return this.schedule("check", () => this.check(why));
    }

    /** Fixes what the check finds, then checks and reports; `finish` adds to the report where the operation stands. */
    static fix(why: string, finish?: (report: DbcheckReport) => DbcheckReport): Promise<void> {
        return this.schedule("fix", () => this.fixAndCheck(why, finish));
    }

    private static schedule(job: DbcheckJob, work: () => Promise<void>): Promise<void> {
        const plan = planDbcheckJob(this.running?.job ?? null, job);
        if (plan === "join") return this.running!.done;
        if (plan === "after") {
            this.queuedFix ??= this.running!.done.then(() => {
                this.queuedFix = null;
                return this.schedule(job, work);
            });
            return this.queuedFix;
        }
        const done = work();
        const running = { job, done };
        this.running = running;
        void done.finally(() => {
            if (this.running === running) this.running = null;
        });
        return done;
    }

    private static async check(why: string, fix?: DbcheckFix, finish?: (report: DbcheckReport) => DbcheckReport): Promise<void> {
        logger.info(`Running the database check: ${why}`);
        const started = Date.now();
        let report: DbcheckReport;
        try {
            const result = await runSambaHelper("dbcheck");
            report = { checkedAt: new Date().toISOString(), errors: result.errors, durationMs: result.durationMs };
            logger.info(`The database check counted ${result.errors} error(s) in ${Math.round(result.durationMs / 1000)} s`);
        } catch (err) {
            // That the check could not be run is what is reported.
            const error = messageOf(err);
            report = { checkedAt: new Date().toISOString(), errors: null, durationMs: Date.now() - started, error };
            logger.error(`The database check could not be run: ${error}`);
        }
        const full = fix ? { ...report, fix } : report;
        this.keep(finish ? finish(full) : full, false);
        this.sendStored();
    }

    private static async fixAndCheck(why: string, finish?: (report: DbcheckReport) => DbcheckReport): Promise<void> {
        logger.warn(`Fixing what the database check finds: ${why}`);
        const started = Date.now();
        let fix: DbcheckFix;
        try {
            const result = await runSambaHelper("dbcheck-fix");
            fix = { fixedAt: new Date().toISOString(), errorsFound: result.errors, durationMs: result.durationMs };
            logger.warn(`The database fix went at ${result.errors} error(s) in ${Math.round(result.durationMs / 1000)} s`);
        } catch (err) {
            // Nothing of it was written: the fix runs in one transaction.
            const error = messageOf(err);
            fix = { fixedAt: new Date().toISOString(), errorsFound: null, durationMs: Date.now() - started, error };
            logger.error(`The database could not be fixed: ${error}`);
        }
        // Run either way: what is left is what the server is to show, after a fix that failed as much as after one that worked.
        await this.check("it follows a fix", fix, finish);
    }
}
