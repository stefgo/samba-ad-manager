import { logger } from "../core/logger.js";
import {
    WS_EVENTS,
    type SchedulerId,
    type SchedulerRunResults,
    type SchedulerStatus,
    type SchedulerStatusUpdate,
    type SchedulerTrigger,
} from "@sadm/shared";
import { SchedulerStateRepository } from "../repositories/SchedulerStateRepository.js";
import { ActivityService } from "./ActivityService.js";
import { DashboardHub } from "./DashboardHub.js";

/** The longest delay `setTimeout` takes; anything above it fires at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

interface ScheduledJobOptions<Id extends SchedulerId> {
    id: Id;
    /** The interval as the settings say it right now; 0 or less switches the timer off. */
    intervalMs: () => number;
    /** Whether a finished run did all it set out to do. Everything is `success` without it. */
    outcome?: (result: SchedulerRunResults[Id]) => "success" | "partial";
    /** Adds what only this scheduler reports, beyond the status every scheduler has. */
    describe?: (status: SchedulerStatus<Id>) => SchedulerStatus<Id>;
}

/**
 * The timer, the bookkeeping and the status of one server scheduler.
 *
 * Every run -- the timer's and a user's -- goes through `run`, which keeps the scheduler's
 * row in `scheduler_state` and tells the dashboard. A run that throws is recorded as
 * `failed` and reported as `scheduler.failed` rather than only logged.
 *
 * The timer is a chain of timeouts rather than an interval, so that the first run after a
 * restart can be placed one interval after the last run instead of one after startup. The
 * planned run is stored as well: before a scheduler has run once, it is all a restart has to
 * go on, and without it a server restarted more often than the interval would never run it.
 */
export class ScheduledJob<Id extends SchedulerId> {
    private timer: NodeJS.Timeout | null = null;
    private nextRun: Date | null = null;
    private running = false;

    constructor(private readonly options: ScheduledJobOptions<Id>) {}

    get isRunning(): boolean {
        return this.running;
    }

    /** Runs `work` as one recorded run of this scheduler and returns its result. */
    async run(
        trigger: SchedulerTrigger,
        work: () => SchedulerRunResults[Id] | Promise<SchedulerRunResults[Id]>,
    ): Promise<SchedulerRunResults[Id]> {
        const { id } = this.options;
        this.running = true;
        SchedulerStateRepository.markStarted(id, trigger, new Date().toISOString());
        this.broadcast();
        try {
            const result = await work();
            const status = this.options.outcome?.(result) ?? "success";
            SchedulerStateRepository.markFinished(id, status, new Date().toISOString(), result, null);
            return result;
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            SchedulerStateRepository.markFinished(id, "failed", new Date().toISOString(), null, error);
            logger.error({ err, scheduler: id, trigger }, "Scheduler run failed");
            ActivityService.record({
                kind: "scheduler.failed",
                level: "error",
                data: { scheduler: id, trigger, error },
            });
            throw err;
        } finally {
            this.running = false;
            this.broadcast();
        }
    }

    /**
     * (Re)starts the timer from the current settings. The first run comes one interval after
     * the last one started -- at once if that is past. A scheduler that has never run keeps
     * the run it had planned, unless that lies more than one interval ahead, as it does after
     * the interval was shortened; with none planned, it comes one interval from now.
     */
    start(runScheduled: () => Promise<unknown>): void {
        this.stop();
        const { id } = this.options;
        const intervalMs = this.options.intervalMs();
        if (intervalMs <= 0) {
            SchedulerStateRepository.savePlannedRun(id, null);
            logger.info({ scheduler: id }, "Scheduler disabled");
            this.broadcast();
            return;
        }
        const now = Date.now();
        const lastStarted = SchedulerStateRepository.lastRun(id)?.startedAt;
        const last = lastStarted ? Date.parse(lastStarted) : NaN;
        const planned = Date.parse(SchedulerStateRepository.plannedRun(id) ?? "");
        const first = !isNaN(last)
            ? Math.max(now, last + intervalMs)
            : !isNaN(planned) && planned <= now + intervalMs
                ? Math.max(now, planned)
                : now + intervalMs;
        this.schedule(new Date(first), runScheduled);
        logger.info({ scheduler: id, intervalMs, nextRun: this.nextRun }, "Scheduler started");
    }

    /** Stops the timer. The planned run stays stored: a shutdown is when it must survive. */
    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.nextRun = null;
    }

    status(): SchedulerStatus<Id> {
        const status: SchedulerStatus<Id> = {
            isRunning: this.running,
            nextRun: this.nextRun?.toISOString() ?? null,
            lastRun: SchedulerStateRepository.lastRun(this.options.id),
        };
        return this.options.describe?.(status) ?? status;
    }

    broadcast(): void {
        DashboardHub.broadcast({
            type: WS_EVENTS.SCHEDULER_STATUS_UPDATE,
            payload: { scheduler: this.options.id, status: this.status() } as SchedulerStatusUpdate,
        });
    }

    private schedule(at: Date, runScheduled: () => Promise<unknown>): void {
        if (this.nextRun?.getTime() !== at.getTime()) {
            SchedulerStateRepository.savePlannedRun(this.options.id, at.toISOString());
        }
        this.nextRun = at;
        this.broadcast();
        // A long interval is waited out in steps: setTimeout cannot take more than ~24 days.
        const wait = Math.min(Math.max(0, at.getTime() - Date.now()), MAX_TIMEOUT_MS);
        this.timer = setTimeout(async () => {
            if (Date.now() < at.getTime()) {
                this.schedule(at, runScheduled);
                return;
            }
            try {
                await runScheduled();
            } catch {
                // Recorded and logged by run().
            }
            const intervalMs = this.options.intervalMs();
            if (intervalMs > 0) {
                this.schedule(new Date(Date.now() + intervalMs), runScheduled);
            } else {
                SchedulerStateRepository.savePlannedRun(this.options.id, null);
                this.nextRun = null;
                this.broadcast();
            }
        }, wait);
        this.timer.unref?.();
    }
}
