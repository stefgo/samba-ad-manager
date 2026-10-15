import db from "../core/Database.js";
import type { TrackedIssue } from "../services/domainIssueTracker.js";

/** A row of `domain_issues` (migrations 02 and 05). */
interface DomainIssueRow {
    id: string;
    type: string;
    severity: string;
    dc: string | null;
    dc_id: string | null;
    text: string;
    state: string;
    seen_since: string;
    last_seen_at: string;
    opened_at: string | null;
    correlation_id: string | null;
    escalating_since: string | null;
}

const toIssue = (row: DomainIssueRow): TrackedIssue => ({
    id: row.id,
    type: row.type,
    severity: row.severity,
    dc: row.dc,
    dcId: row.dc_id,
    text: row.text,
    state: row.state === "pending" ? "pending" : "open",
    seenSince: row.seen_since,
    lastSeenAt: row.last_seen_at,
    openedAt: row.opened_at,
    correlationId: row.correlation_id,
    escalatingSince: row.escalating_since,
});

/** The findings the server tracks: those waiting to be reported, and those reported and not yet called off. */
export class DomainIssueRepository {
    static findAll(): TrackedIssue[] {
        return (db.prepare("SELECT * FROM domain_issues").all() as DomainIssueRow[]).map(toIssue);
    }

    /** Writes the rows a step saved and deletes the ones it removed, in one transaction. */
    static apply(save: readonly TrackedIssue[], remove: readonly string[]): void {
        const upsert = db.prepare(
            `INSERT OR REPLACE INTO domain_issues
               (id, type, severity, dc, dc_id, text, state, seen_since, last_seen_at, opened_at, correlation_id, escalating_since)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const del = db.prepare("DELETE FROM domain_issues WHERE id = ?");
        db.transaction(() => {
            for (const id of remove) del.run(id);
            for (const issue of save) {
                upsert.run(
                    issue.id,
                    issue.type,
                    issue.severity,
                    issue.dc,
                    issue.dcId,
                    issue.text,
                    issue.state,
                    issue.seenSince,
                    issue.lastSeenAt,
                    issue.openedAt,
                    issue.correlationId,
                    issue.escalatingSince,
                );
            }
        })();
    }
}
