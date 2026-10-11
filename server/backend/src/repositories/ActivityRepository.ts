import db from "../core/Database.js";
import type { ActivityEvent, ActivityLevel, ActivityRecord } from "@sadm/shared";

interface ActivityRow {
    id: string;
    dc_id: string | null;
    kind: string;
    level: string;
    correlation_id: string | null;
    subject: string | null;
    data: string | null;
    occurred_at: string;
    /** Not a column: whether the user `SELECT_RECORD` was asked about has seen the event. */
    seen: 0 | 1;
}

/**
 * An event with whether one user has seen it, as `rowToRecord` reads it. The first bound
 * parameter is that user's id; `null` matches nobody, which is right for an event just stored.
 */
const SELECT_RECORD = `
    SELECT a.*,
        EXISTS (SELECT 1 FROM activity_seen s WHERE s.activity_id = a.id AND s.user_id = ?) AS seen
    FROM activity a`;

function rowToRecord(row: ActivityRow): ActivityRecord {
    return {
        id: row.id,
        dcId: row.dc_id,
        kind: row.kind,
        level: row.level as ActivityLevel,
        correlationId: row.correlation_id,
        subject: row.subject ? JSON.parse(row.subject) : null,
        data: row.data ? JSON.parse(row.data) : null,
        occurredAt: row.occurred_at,
        seen: row.seen === 1,
    };
}

export class ActivityRepository {
    /** Newest first. `seen` is that of `userId`: each user gets the list as they have worked through it. */
    static list(userId: number): ActivityRecord[] {
        const rows = db
            .prepare(`${SELECT_RECORD} ORDER BY a.occurred_at DESC`)
            .all(userId) as ActivityRow[];
        return rows.map(rowToRecord);
    }

    /** Stores an event and returns it as a record nobody has seen yet. */
    static insert(event: ActivityEvent): ActivityRecord {
        db.prepare(
            `INSERT INTO activity (id, dc_id, kind, level, correlation_id, subject, data, occurred_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            event.id,
            event.dcId ?? null,
            event.kind,
            event.level,
            event.correlationId ?? null,
            event.subject ? JSON.stringify(event.subject) : null,
            event.data ? JSON.stringify(event.data) : null,
            event.occurredAt,
        );
        return rowToRecord(db.prepare(`${SELECT_RECORD} WHERE a.id = ?`).get(null, event.id) as ActivityRow);
    }

    /**
     * Marks the given events seen by `userId`; ids that are not there are skipped. Returns
     * the ids that were not seen by that user before -- the ones there is anything to tell.
     *
     * One statement. The ids go in as a single JSON parameter, so the length of the list is
     * bounded by the request body, not by SQLite's limit on bound variables. A user deleted
     * while their session is still valid marks nothing instead of failing the foreign key.
     */
    static markManySeen(ids: string[], userId: number): string[] {
        const rows = db
            .prepare(`
                INSERT OR IGNORE INTO activity_seen (activity_id, user_id)
                SELECT a.id, u.id
                FROM activity a, users u
                WHERE a.id IN (SELECT value FROM json_each(?)) AND u.id = ?
                RETURNING activity_id
            `)
            .all(JSON.stringify(ids), userId) as { activity_id: string }[];
        return rows.map((r) => r.activity_id);
    }

    static deleteAll(): void {
        db.prepare("DELETE FROM activity").run();
    }

    static count(): number {
        const row = db.prepare("SELECT COUNT(*) as c FROM activity").get() as { c: number };
        return row.c;
    }

    /** Removes events older than ttlDays while keeping at least minKeep of the most recent ones. */
    static cleanupOld(ttlDays: number, minKeep: number): number {
        const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();

        const anchor = db
            .prepare("SELECT occurred_at FROM activity ORDER BY occurred_at DESC LIMIT 1 OFFSET ?")
            .get(Math.max(0, minKeep - 1)) as { occurred_at: string } | undefined;

        let sql = "DELETE FROM activity WHERE occurred_at < ?";
        const params: string[] = [cutoff];

        if (anchor) {
            sql += " AND occurred_at < ?";
            params.push(anchor.occurred_at);
        }

        return db.prepare(sql).run(...params).changes;
    }
}
