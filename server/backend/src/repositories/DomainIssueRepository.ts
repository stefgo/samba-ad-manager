import db from "../core/Database.js";
import type { OpenIssue } from "../services/domainIssueTracker.js";

/** A row of `domain_issues` (migration 02). */
interface DomainIssueRow {
    id: string;
    type: string;
    severity: string;
    dc: string | null;
    client_id: string | null;
    text: string;
    opened_at: string;
    correlation_id: string;
}

/** The findings that have been announced and not yet called off. */
export class DomainIssueRepository {
    static findAll(): OpenIssue[] {
        return (db.prepare("SELECT * FROM domain_issues").all() as DomainIssueRow[]).map((row) => ({
            id: row.id,
            type: row.type,
            severity: row.severity,
            dc: row.dc,
            clientId: row.client_id,
            text: row.text,
            openedAt: row.opened_at,
            correlationId: row.correlation_id,
        }));
    }

    static insert(issue: OpenIssue): void {
        db.prepare(
            `INSERT OR REPLACE INTO domain_issues (id, type, severity, dc, client_id, text, opened_at, correlation_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(issue.id, issue.type, issue.severity, issue.dc, issue.clientId, issue.text, issue.openedAt, issue.correlationId);
    }

    static updateText(id: string, text: string): void {
        db.prepare("UPDATE domain_issues SET text = ? WHERE id = ?").run(text, id);
    }

    static delete(id: string): void {
        db.prepare("DELETE FROM domain_issues WHERE id = ?").run(id);
    }
}
