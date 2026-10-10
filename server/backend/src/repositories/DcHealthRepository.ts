import db from "../core/Database.js";

/** A row of `dc_health` (migration 01). `report` is JSON text. */
export interface DcHealthRow {
    client_id: string;
    report: string;
    dc_name: string | null;
    clock_offset_ms: number | null;
    received_at: string;
}

/** The last measurement of each client's domain controller. Every write is an upsert. */
export class DcHealthRepository {
    static findAll(): DcHealthRow[] {
        return db.prepare("SELECT * FROM dc_health").all() as DcHealthRow[];
    }

    static find(clientId: string): DcHealthRow | undefined {
        return db.prepare("SELECT * FROM dc_health WHERE client_id = ?").get(clientId) as DcHealthRow | undefined;
    }

    static save(row: DcHealthRow): void {
        db.prepare(
            `INSERT INTO dc_health (client_id, report, dc_name, clock_offset_ms, received_at)
             VALUES (@client_id, @report, @dc_name, @clock_offset_ms, @received_at)
             ON CONFLICT(client_id) DO UPDATE SET
                report = excluded.report,
                dc_name = excluded.dc_name,
                clock_offset_ms = excluded.clock_offset_ms,
                received_at = excluded.received_at`,
        ).run(row);
    }

    static delete(clientId: string): void {
        db.prepare("DELETE FROM dc_health WHERE client_id = ?").run(clientId);
    }
}
