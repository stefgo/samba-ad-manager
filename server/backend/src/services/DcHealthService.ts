import {
    DbcheckReportSchema,
    DcDbcheckSchema,
    DcLocalReportSchema,
    DcLocalSchema,
    DcMeasurementSchema,
    WS_EVENTS,
    type DcDbcheck,
    type DcHealth,
    type DcLocal,
    type DcMeasurement,
} from "@sadm/shared";
import { logger } from "../core/logger.js";
import { DcDbcheckRepository } from "../repositories/DcDbcheckRepository.js";
import { DcHealthRepository } from "../repositories/DcHealthRepository.js";
import { DcLocalRepository } from "../repositories/DcLocalRepository.js";
import { DashboardHub } from "./DashboardHub.js";

/**
 * What is known about the health of each domain controller: the last measurement this
 * server took, and what its agent last reported -- what it reads locally, and the database
 * check. Keeps the three and tells the dashboards about each new one.
 */
export class DcHealthService {
    /** Told whenever what is known of a domain controller changed. A listener rather than a call into whoever evaluates it. */
    private static listeners: ((dcId: string) => void)[] = [];

    static onUpdate(listener: (dcId: string) => void): void {
        this.listeners.push(listener);
    }

    private static changed(dcId: string): void {
        const health = this.get(dcId);
        if (health) DashboardHub.broadcast({ type: WS_EVENTS.DC_HEALTH_UPDATE, payload: health });
        for (const listener of this.listeners) {
            try {
                listener(dcId);
            } catch (err) {
                logger.warn({ err, dcId }, "A listener failed on a change of a domain controller's health");
            }
        }
    }

    /** A stored value against its schema; null, and a line in the log, for one that no longer fits. */
    private static parse<T>(schema: { safeParse(value: unknown): { success: boolean; data?: T } }, text: string, dcId: string): T | null {
        try {
            const parsed = schema.safeParse(JSON.parse(text));
            if (parsed.success) return parsed.data as T;
        } catch {
            // Falls through to the warning.
        }
        logger.warn({ dcId }, "A stored health record could not be read");
        return null;
    }

    private static dbcheckOf(dcId: string): DcDbcheck | null {
        const row = DcDbcheckRepository.find(dcId);
        return row ? this.parse<DcDbcheck>(DcDbcheckSchema, row.report, dcId) : null;
    }

    private static localOf(dcId: string): DcLocal | null {
        const row = DcLocalRepository.find(dcId);
        return row ? this.parse<DcLocal>(DcLocalSchema, row.report, dcId) : null;
    }

    static storeMeasurement(dcId: string, measurement: DcMeasurement): void {
        DcHealthRepository.save({ dc_id: dcId, measurement: JSON.stringify(measurement), measured_at: measurement.collectedAt });
        this.changed(dcId);
    }

    /** What an agent sent after a run of the database check. Dropped, with a line in the log, when it is not a report. */
    static storeDbcheck(dcId: string, payload: unknown): void {
        const parsed = DbcheckReportSchema.safeParse(payload);
        if (!parsed.success) {
            logger.warn({ dcId, issues: parsed.error.issues }, "Ignoring a database check report that is not one");
            return;
        }
        const receivedAt = new Date().toISOString();
        const dbcheck: DcDbcheck = { ...parsed.data, receivedAt };
        DcDbcheckRepository.save({ dc_id: dcId, report: JSON.stringify(dbcheck), received_at: receivedAt });
        this.changed(dcId);
    }

    /** What an agent read on its domain controller. */
    static storeLocal(dcId: string, payload: unknown): void {
        const parsed = DcLocalReportSchema.safeParse(payload);
        if (!parsed.success) {
            logger.warn({ dcId, issues: parsed.error.issues }, "Ignoring a local report that is not one");
            return;
        }
        const receivedAt = new Date().toISOString();
        const local: DcLocal = { ...parsed.data, receivedAt };
        DcLocalRepository.save({ dc_id: dcId, report: JSON.stringify(local), received_at: receivedAt });
        this.changed(dcId);
    }

    /** Forgets what the agent of a domain controller reported: it has none any more. */
    static clearAgentData(dcId: string): void {
        DcDbcheckRepository.delete(dcId);
        DcLocalRepository.delete(dcId);
        this.changed(dcId);
    }

    /**
     * The last measurement of a domain controller with what its agent last reported, or null
     * before the first measurement -- which a minute after it was first listed is over.
     */
    static get(dcId: string): DcHealth | null {
        const row = DcHealthRepository.find(dcId);
        const measurement = row ? this.parse<DcMeasurement>(DcMeasurementSchema, row.measurement, dcId) : null;
        return measurement ? { ...measurement, dcId, dbcheck: this.dbcheckOf(dcId), local: this.localOf(dcId) } : null;
    }

    /** The same for every domain controller that has been measured. */
    static getAll(): DcHealth[] {
        return DcHealthRepository.findAll().flatMap((row) => {
            const health = this.get(row.dc_id);
            return health ? [health] : [];
        });
    }
}
