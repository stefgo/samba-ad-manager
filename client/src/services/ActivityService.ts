import { randomUUID } from "crypto";
import {
    ActivityEvent,
    ActivityEventSchema,
    ActivityKind,
    ActivityLevel,
    ActivitySubject,
} from "@sadm/shared";
import { logger } from "@sadm/shared/node";
import { readJsonFile, writeJsonFile } from "../core/DataStore.js";

/**
 * How many events the agent holds while it has nowhere to send them. A host that has been
 * cut off for days must not grow its queue without bound; the oldest go first, because a
 * week-old state change is the least worth keeping.
 */
const MAX_QUEUED = 500;

/**
 * How old a queued event may be. A host that has been cut off for a fortnight has nothing
 * worth telling about the failover on the first morning, and delivering it
 * would drop a two-week-old line into the middle of today's list.
 */
const MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The queue on disk, so a restart does not lose a failover the server has not heard of. */
const QUEUE_FILE = "queue.json";

/**
 * Writes are coalesced: a failover produces a burst of events within a second or two, and
 * each of them would otherwise be its own write-and-rename.
 */
const QUEUE_WRITE_DELAY_MS = 1000;

/**
 * How long a batch that went out may stay unacknowledged before it is offered again. The
 * server withholds the ack for what it failed to store; without a retry those events would
 * wait for the next event or the next reconnect, which on a quiet host may be days away.
 */
const ACK_RETRY_MS = 60_000;

/**
 * The agent's activity reporting: it turns what it observes into events and gets them to
 * the server.
 *
 * Delivery is at-least-once. An event is kept until the server acknowledges its id, which
 * is why the id is given here and not there: a repeat then carries the same id and the
 * server's primary key makes the second copy a no-op. A failover at three in the morning
 * with no server to talk to is therefore on record once the server is back.
 */
export class ActivityService {
    private static queue: ActivityEvent[] = [];
    private static send: ((events: ActivityEvent[]) => boolean) | null = null;
    private static loaded = false;
    private static writeTimer: NodeJS.Timeout | null = null;
    private static retryTimer: NodeJS.Timeout | null = null;

    /**
     * Reads back what the last run of the process had not had acknowledged. Anything that
     * does not parse is left out rather than taken on trust: these go on the wire as facts
     * about this host, and a damaged file must not turn into an event nobody can source.
     */
    private static load(): void {
        if (this.loaded) return;
        this.loaded = true;

        const stored = readJsonFile(QUEUE_FILE);
        if (!Array.isArray(stored)) return;

        const oldest = Date.now() - MAX_QUEUE_AGE_MS;
        const events: ActivityEvent[] = [];
        let dropped = 0;
        for (const entry of stored) {
            const parsed = ActivityEventSchema.safeParse(entry);
            if (!parsed.success || isExpired(parsed.data, oldest)) {
                dropped++;
                continue;
            }
            events.push(parsed.data);
        }

        this.queue = events.slice(-MAX_QUEUED);
        if (this.queue.length > 0 || dropped > 0) {
            logger.info(
                { restored: this.queue.length, dropped },
                "Restored the activity queue from disk",
            );
        }
    }

    /** Schedules the queue to be written out, coalescing a burst into one write. */
    private static persist(): void {
        if (this.writeTimer) return;
        this.writeTimer = setTimeout(() => {
            this.writeTimer = null;
            writeJsonFile(QUEUE_FILE, this.queue);
        }, QUEUE_WRITE_DELAY_MS);
        this.writeTimer.unref?.();
    }

    /**
     * Writes the queue out now, for a shutdown that is about to end the process. The
     * scheduled write is unref'd so it cannot hold the agent open, which means a SIGTERM
     * arriving inside the coalescing window would otherwise take the last events with it.
     */
    static persistNow(): void {
        if (this.writeTimer) {
            clearTimeout(this.writeTimer);
            this.writeTimer = null;
        }
        if (this.loaded) writeJsonFile(QUEUE_FILE, this.queue);
    }

    /**
     * Wires up the transport. `send` reports whether the batch went out; a false answer
     * leaves everything queued for the next connection.
     */
    static setTransport(send: (events: ActivityEvent[]) => boolean): void {
        this.send = send;
    }

    /** Records one event and offers it to the server straight away. */
    static report(input: {
        kind: ActivityKind;
        level: ActivityLevel;
        occurredAt?: string;
        correlationId?: string | null;
        subject?: ActivitySubject | null;
        data?: Record<string, unknown> | null;
    }): void {
        this.enqueue({
            id: randomUUID(),
            occurredAt: input.occurredAt ?? new Date().toISOString(),
            source: "agent",
            clientId: null,
            kind: input.kind,
            level: input.level,
            correlationId: input.correlationId ?? null,
            subject: input.subject ?? null,
            data: input.data ?? null,
        });
    }

    private static enqueue(event: ActivityEvent): void {
        this.load();
        this.queue.push(event);
        if (this.queue.length > MAX_QUEUED) {
            const dropped = this.queue.length - MAX_QUEUED;
            this.queue.splice(0, dropped);
            logger.warn({ dropped }, "Activity queue full, dropped the oldest events");
        }
        this.persist();
        this.flush();
    }

    /**
     * Offers everything unacknowledged to the server. Called on every reconnect too.
     *
     * A batch that went out arms the retry timer; one that could not go out does not, since
     * the reconnect flushes anyway and a timer would only find the socket closed again.
     */
    static flush(): void {
        this.load();
        this.clearRetry();
        this.expire();
        if (this.queue.length === 0 || !this.send) return;
        if (!this.send([...this.queue])) return;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.flush();
        }, ACK_RETRY_MS);
        this.retryTimer.unref?.();
    }

    /** Drops what the server has stored. Ids it does not name stay and are offered again. */
    static acknowledge(ids: string[]): void {
        if (ids.length === 0) return;
        this.load();
        const acked = new Set(ids);
        const before = this.queue.length;
        this.queue = this.queue.filter((event) => !acked.has(event.id));
        if (this.queue.length !== before) this.persist();
        if (this.queue.length === 0) this.clearRetry();
    }

    /**
     * Drops what has been queued longer than MAX_QUEUE_AGE_MS. `load` does the same, but only
     * once per process: an agent that stays up through a fortnight without its server, and
     * sees fewer than MAX_QUEUED events in that time, would otherwise deliver the first
     * morning's events on reconnect. Checked before every send, so nothing expired goes out.
     */
    private static expire(): void {
        const oldest = Date.now() - MAX_QUEUE_AGE_MS;
        const before = this.queue.length;
        this.queue = this.queue.filter((event) => !isExpired(event, oldest));
        const dropped = before - this.queue.length;
        if (dropped === 0) return;
        logger.warn({ dropped }, "Dropped queued activity events older than the queue keeps");
        this.persist();
    }

    private static clearRetry(): void {
        if (!this.retryTimer) return;
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
    }
}

/** Whether an event occurred before `oldest`. One without a readable time is kept. */
function isExpired(event: ActivityEvent, oldest: number): boolean {
    const occurred = Date.parse(event.occurredAt);
    return !Number.isNaN(occurred) && occurred < oldest;
}
