import { AGENT_EVENTS, type ReplicationSyncReport } from "@sadm/shared";
import { Connection } from "../core/Connection.js";
import { logger } from "../core/logger.js";
import { runSambaHelper } from "./SambaHelper.js";

/**
 * Replicates from every inbound partner when the server asks: Samba's replication service is
 * asked to pull each link now instead of at its next round. Nothing is chosen -- which links
 * there are is what the replication service says -- and nothing is written that the service
 * would not have pulled anyway.
 *
 * The result is sent when it is there and not kept: one from before a lost connection
 * describes a moment the next measurement has long overtaken.
 */

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 2000);

export class ReplicationSyncService {
    /** A replication under way. A second request while it runs is that replication. */
    private static running: Promise<void> | null = null;

    static start(): void {
        Connection.onServerMessage(AGENT_EVENTS.REQUEST_REPLICATION_SYNC, () => void this.sync());
    }

    static sync(): Promise<void> {
        this.running ??= this.replicate().finally(() => {
            this.running = null;
        });
        return this.running;
    }

    private static async replicate(): Promise<void> {
        logger.info("Replicating from every inbound partner: the server asked");
        const started = Date.now();
        let report: ReplicationSyncReport;
        try {
            const result = await runSambaHelper("replicate");
            report = { syncedAt: new Date().toISOString(), durationMs: result.durationMs, links: result.links };
            const failed = result.links.filter((link) => link.error).length;
            const summary = `${result.links.length} link(s), ${failed} failed, in ${Math.round(result.durationMs / 1000)} s`;
            if (failed > 0) logger.warn(`Replicated from the inbound partners: ${summary}`);
            else logger.info(`Replicated from the inbound partners: ${summary}`);
        } catch (err) {
            // That nothing could be asked is what is reported.
            const error = messageOf(err);
            report = { syncedAt: new Date().toISOString(), durationMs: Date.now() - started, error, links: [] };
            logger.error(`Could not replicate from the inbound partners: ${error}`);
        }
        if (!Connection.send(AGENT_EVENTS.REPLICATION_SYNC_REPORT, report)) {
            logger.debug("The server is gone; the result of the replication is dropped");
        }
    }
}
