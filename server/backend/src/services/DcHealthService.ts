import { DcHealthReportSchema, WS_EVENTS, type DcHealth, type DcHealthReport } from "@sadm/shared";
import { logger } from "@sadm/shared/node";
import { DcHealthRepository, type DcHealthRow } from "../repositories/DcHealthRepository.js";
import { ProxyService } from "./ProxyService.js";

/**
 * A measurement older than this on arrival says nothing about the clock: it sat in a queue
 * or on a slow link, and the difference would be that delay, not an offset.
 */
const MAX_TRANSIT_MS = 15_000;

/**
 * Keeps the last measurement every agent sent of its domain controller, and tells the
 * dashboards about each new one.
 *
 * The measurement is stored as the agent sent it. What the server adds is what only it can
 * know: when the measurement arrived, how far the agent's clock was from its own at that
 * moment, and the domain controller's name from the last time it could be read.
 */
export class DcHealthService {
    /** Told about every stored measurement. A listener rather than a call into whoever evaluates them. */
    private static listeners: ((health: DcHealth) => void)[] = [];

    static onUpdate(listener: (health: DcHealth) => void): void {
        this.listeners.push(listener);
    }

    private static toHealth(row: DcHealthRow): DcHealth | null {
        try {
            const report = JSON.parse(row.report) as DcHealthReport;
            return {
                ...report,
                clientId: row.client_id,
                receivedAt: row.received_at,
                dcName: row.dc_name,
                clockOffsetMs: row.clock_offset_ms,
            };
        } catch (err) {
            logger.warn({ err, clientId: row.client_id }, "A stored health measurement could not be read");
            return null;
        }
    }

    /** `DC_HEALTH` from an agent. */
    static handleReport(clientId: string, payload: unknown): void {
        const parsed = DcHealthReportSchema.safeParse(payload);
        if (!parsed.success) {
            logger.warn({ clientId, issues: parsed.error.issues }, "Ignoring malformed DC_HEALTH from agent");
            return;
        }
        const report = parsed.data;
        const now = Date.now();
        const collectedAt = Date.parse(report.collectedAt);
        const previous = DcHealthRepository.find(clientId);

        // The agent sends a measurement the moment it has taken it, so the two times differ
        // by the offset of the clocks plus the transit -- which is milliseconds on a live
        // link. One that took longer is not a statement about the clock; the last offset stays.
        let clockOffsetMs = previous?.clock_offset_ms ?? null;
        if (!Number.isNaN(collectedAt)) {
            const difference = collectedAt - now;
            const plausible = Math.abs(difference) > MAX_TRANSIT_MS || difference >= -MAX_TRANSIT_MS;
            if (plausible) clockOffsetMs = difference;
        }

        const row: DcHealthRow = {
            client_id: clientId,
            report: JSON.stringify(report),
            dc_name: report.identity?.name ?? previous?.dc_name ?? null,
            clock_offset_ms: clockOffsetMs,
            received_at: new Date(now).toISOString(),
        };
        DcHealthRepository.save(row);

        const health = this.toHealth(row);
        if (!health) return;
        ProxyService.broadcastToDashboard({ type: WS_EVENTS.DC_HEALTH_UPDATE, payload: health });
        for (const listener of this.listeners) {
            try {
                listener(health);
            } catch (err) {
                logger.warn({ err, clientId }, "A listener failed on a health measurement");
            }
        }
    }

    /** The last measurement of every client that has one. */
    static getAll(): DcHealth[] {
        return DcHealthRepository.findAll()
            .map((row) => this.toHealth(row))
            .filter((health): health is DcHealth => health !== null);
    }

    static get(clientId: string): DcHealth | null {
        const row = DcHealthRepository.find(clientId);
        return row ? this.toHealth(row) : null;
    }
}
