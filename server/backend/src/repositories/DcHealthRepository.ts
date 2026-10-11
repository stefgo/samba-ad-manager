import db from "../core/Database.js";

/** A row of `dc_health` (migration 01). `measurement` is JSON text. */
export interface DcHealthRow {
    dc_id: string;
    measurement: string;
    measured_at: string;
}

/** The last measurement of each domain controller. Every write is an upsert. */
export class DcHealthRepository {
    static findAll(): DcHealthRow[] {
        return db.prepare("SELECT * FROM dc_health").all() as DcHealthRow[];
    }

    static find(dcId: string): DcHealthRow | undefined {
        return db.prepare("SELECT * FROM dc_health WHERE dc_id = ?").get(dcId) as DcHealthRow | undefined;
    }

    static save(row: DcHealthRow): void {
        db.prepare(
            `INSERT INTO dc_health (dc_id, measurement, measured_at)
             VALUES (@dc_id, @measurement, @measured_at)
             ON CONFLICT(dc_id) DO UPDATE SET
                measurement = excluded.measurement,
                measured_at = excluded.measured_at`,
        ).run(row);
    }
}
