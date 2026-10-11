import db from "../core/Database.js";

/** A row of `dns_server_health` (migration 03). `health` is JSON text. */
export interface DnsServerHealthRow {
    name: string;
    health: string;
    measured_at: string;
}

/** The last answer of each name server that is no domain controller. */
export class DnsServerHealthRepository {
    static findAll(): DnsServerHealthRow[] {
        return db.prepare("SELECT * FROM dns_server_health ORDER BY name").all() as DnsServerHealthRow[];
    }

    /** Makes the table hold exactly these: a server that is no longer among them is forgotten. */
    static replaceAll(rows: readonly DnsServerHealthRow[]): void {
        const insert = db.prepare(
            `INSERT INTO dns_server_health (name, health, measured_at) VALUES (@name, @health, @measured_at)`,
        );
        db.transaction(() => {
            db.prepare("DELETE FROM dns_server_health").run();
            for (const row of rows) insert.run(row);
        })();
    }
}
