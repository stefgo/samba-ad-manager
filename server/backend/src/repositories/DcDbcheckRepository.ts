import db from "../core/Database.js";

/** A row of `dc_dbcheck` (migration 01). `report` is JSON text. */
export interface DcDbcheckRow {
    dc_id: string;
    report: string;
    received_at: string;
}

/** The last database check each domain controller reported. Every write is an upsert. */
export class DcDbcheckRepository {
    static findAll(): DcDbcheckRow[] {
        return db.prepare("SELECT * FROM dc_dbcheck").all() as DcDbcheckRow[];
    }

    static find(dcId: string): DcDbcheckRow | undefined {
        return db.prepare("SELECT * FROM dc_dbcheck WHERE dc_id = ?").get(dcId) as DcDbcheckRow | undefined;
    }

    static save(row: DcDbcheckRow): void {
        db.prepare(
            `INSERT INTO dc_dbcheck (dc_id, report, received_at)
             VALUES (@dc_id, @report, @received_at)
             ON CONFLICT(dc_id) DO UPDATE SET
                report = excluded.report,
                received_at = excluded.received_at`,
        ).run(row);
    }

    static delete(dcId: string): void {
        db.prepare("DELETE FROM dc_dbcheck WHERE dc_id = ?").run(dcId);
    }
}
