import db from "../core/Database.js";

/** A row of `dc_local` (migration 04). `report` is JSON text. */
export interface DcLocalRow {
    dc_id: string;
    report: string;
    received_at: string;
}

/** The last report of each domain controller's agent of what it reads locally. Every write is an upsert. */
export class DcLocalRepository {
    static find(dcId: string): DcLocalRow | undefined {
        return db.prepare("SELECT * FROM dc_local WHERE dc_id = ?").get(dcId) as DcLocalRow | undefined;
    }

    static save(row: DcLocalRow): void {
        db.prepare(
            `INSERT INTO dc_local (dc_id, report, received_at)
             VALUES (@dc_id, @report, @received_at)
             ON CONFLICT(dc_id) DO UPDATE SET
                report = excluded.report,
                received_at = excluded.received_at`,
        ).run(row);
    }

    static delete(dcId: string): void {
        db.prepare("DELETE FROM dc_local WHERE dc_id = ?").run(dcId);
    }
}
