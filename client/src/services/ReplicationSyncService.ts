import { z } from "zod";
import {
    AGENT_EVENTS,
    ReplicationSyncReportSchema,
    ReplicationSyncRequestSchema,
    type ReplicationSyncReport,
} from "@sadm/shared";
import { Connection } from "../core/Connection.js";
import { readJsonFile, writeJsonFile } from "../core/DataStore.js";
import { logger } from "../core/logger.js";
import { runSambaHelper } from "./SambaHelper.js";
import { SeriesSchema, afterAttempt, startSeries, waitBeforeResuming, type Series } from "./series.js";

/**
 * Replicates from every inbound partner when the server asks: Samba's replication service is
 * asked to pull each link now instead of at its next round. Nothing is chosen -- which links
 * there are is what the replication service says -- and nothing is written that the service
 * would not have pulled anyway.
 *
 * A replication that fails, on one link or on all, is tried again as often and as far apart
 * as the request says, every link again. So is one that found no link where the request says
 * there are partners: a domain controller that has just joined gets its links from the
 * topology checker within minutes. Every report carries where that stands (`series`), and the
 * operation is kept on disk, so a restart carries it on.
 *
 * The last report is kept on disk with whether the server has it, and sent on the next
 * connection: the outcome of an operation the server is waiting for.
 */

const LAST_FILE = "replication-last.json";
const SERIES_FILE = "replication-series.json";
const StoredSchema = z.object({ report: ReplicationSyncReportSchema, sent: z.boolean() });

/** The series with what only a replication needs: whether no link is a failure. */
const ReplicationSeriesSchema = SeriesSchema.extend({ expectPartners: z.boolean() });
type ReplicationSeries = Series & { expectPartners: boolean };

/**
 * Whether a replication left nothing to try again: the replication service was reached, no
 * link failed, and there was a link -- or there is no partner to have one with.
 */
export function syncSucceeded(report: Pick<ReplicationSyncReport, "error" | "links">, expectPartners: boolean): boolean {
    if (report.error) return false;
    if (report.links.some((link) => link.error)) return false;
    return report.links.length > 0 || !expectPartners;
}

/** What the history of an operation keeps of one replication. */
export const syncEntry = (report: Pick<ReplicationSyncReport, "error" | "links">): Record<string, unknown> => ({
    links: report.links.length,
    failed: report.links.filter((link) => link.error).length,
    ...(report.error ? { error: report.error } : {}),
});

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 2000);

export class ReplicationSyncService {
    /** A replication under way. A second request while it runs is that replication. */
    private static running: Promise<void> | null = null;
    private static stored: z.infer<typeof StoredSchema> | null = null;
    /** The operation under way, from the request until its last attempt has been reported. */
    private static series: ReplicationSeries | null = null;
    private static nextAttempt: NodeJS.Timeout | null = null;

    static start(): void {
        const parsed = StoredSchema.safeParse(readJsonFile(LAST_FILE));
        this.stored = parsed.success ? parsed.data : null;
        Connection.onServerMessage(AGENT_EVENTS.REQUEST_REPLICATION_SYNC, (payload) => this.requested(payload));
        Connection.onConnected(() => this.sendStored());
        this.resume();
    }

    /** A request to replicate: the start of an operation, or part of the one under way. */
    private static requested(payload: unknown): void {
        const request = ReplicationSyncRequestSchema.safeParse(payload ?? {});
        if (!request.success) {
            logger.warn({ issues: request.error.issues }, "The server asked to replicate with a request that is not one");
            return;
        }
        if (this.series) {
            logger.info("The server asked to replicate while a replication is under way: it is the same one");
            return;
        }
        this.series = { ...startSeries(request.data), expectPartners: request.data.expectPartners === true };
        this.keepSeries();
        void this.attempt("the server asked");
    }

    /** Carries on with an operation the agent was in when it stopped. */
    private static resume(): void {
        const parsed = ReplicationSeriesSchema.nullable().safeParse(readJsonFile(SERIES_FILE));
        if (!parsed.success || !parsed.data) return;
        this.series = parsed.data;
        const wait = waitBeforeResuming(parsed.data, Date.now());
        logger.info(`Carrying on with a replication, attempt ${parsed.data.attempt} of ${parsed.data.of}, in ${Math.round(wait / 1000)} s`);
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

    private static keep(report: ReplicationSyncReport, sent: boolean): void {
        this.stored = { report, sent };
        writeJsonFile(LAST_FILE, this.stored);
    }

    private static sendStored(): void {
        if (!this.stored || this.stored.sent) return;
        if (Connection.send(AGENT_EVENTS.REPLICATION_SYNC_REPORT, this.stored.report)) this.keep(this.stored.report, true);
    }

    /** One attempt of the operation under way: replicate, and report where it stands. */
    private static attempt(why: string): Promise<void> {
        const series = this.series;
        if (!series) return Promise.resolve();
        this.series = { ...series, nextAttemptAt: null };
        this.keepSeries();
        this.running ??= this.replicate(`${why}, attempt ${series.attempt} of ${series.of}`)
            .then((report) => {
                const current = this.series ?? series;
                const step = afterAttempt(current, syncSucceeded(report, current.expectPartners), syncEntry(report), Date.now());
                this.series = step.series ? { ...step.series, expectPartners: current.expectPartners } : null;
                this.keepSeries();
                if (this.series) this.scheduleAttempt(waitBeforeResuming(this.series, Date.now()));
                this.keep({ ...report, series: step.state }, false);
                this.sendStored();
            })
            .finally(() => {
                this.running = null;
            });
        return this.running;
    }

    private static async replicate(why: string): Promise<ReplicationSyncReport> {
        logger.info(`Replicating from every inbound partner: ${why}`);
        const started = Date.now();
        try {
            const result = await runSambaHelper("replicate");
            const failed = result.links.filter((link) => link.error).length;
            const summary = `${result.links.length} link(s), ${failed} failed, in ${Math.round(result.durationMs / 1000)} s`;
            if (failed > 0) logger.warn(`Replicated from the inbound partners: ${summary}`);
            else logger.info(`Replicated from the inbound partners: ${summary}`);
            return { syncedAt: new Date().toISOString(), durationMs: result.durationMs, links: result.links };
        } catch (err) {
            // That nothing could be asked is what is reported.
            const error = messageOf(err);
            logger.error(`Could not replicate from the inbound partners: ${error}`);
            return { syncedAt: new Date().toISOString(), durationMs: Date.now() - started, error, links: [] };
        }
    }
}
