import db from "../core/Database.js";
import { emptyHistory } from "../services/issueHistory.js";
import type { TrackedFinding, TrackedIncident } from "../services/domainIncidentTracker.js";

/** A row of `domain_incidents` (migration 06). */
interface IncidentRow {
    key: string;
    dc: string | null;
    dc_id: string | null;
    since: string;
    last_seen_at: string;
    opened_at: string;
    correlation_id: string;
}

/** A row of `domain_incident_findings` (migration 06). */
interface FindingRow {
    incident_key: string;
    finding_id: string;
    type: string;
    severity: string;
    reported_severity: string;
    text: string;
    since: string;
    last_seen_at: string;
    reported_at: string;
    escalating_since: string | null;
}

/** A reported finding as it comes back after a restart: what it went through before is gone with the memory. */
const toFinding = (row: FindingRow): TrackedFinding => ({
    id: row.finding_id,
    type: row.type,
    severity: row.severity,
    worstSeverity: row.severity === "error" || row.reported_severity === "error" ? "error" : row.severity,
    text: row.text,
    state: "reported",
    since: row.since,
    lastSeenAt: row.last_seen_at,
    goneSince: null,
    reportedAt: row.reported_at,
    reportedSeverity: row.reported_severity,
    escalatingSince: row.escalating_since,
    gaps: 0,
    history: emptyHistory(),
});

/**
 * The incidents that were reported and have not had their all-clear, with the findings
 * reported in them: what a restart must not forget. Everything else about an incident is
 * the server's memory.
 */
export class DomainIncidentRepository {
    static findOpen(): TrackedIncident[] {
        const findings = db.prepare("SELECT * FROM domain_incident_findings ORDER BY reported_at, finding_id").all() as FindingRow[];
        const rows = db.prepare("SELECT * FROM domain_incidents ORDER BY key").all() as IncidentRow[];
        return rows.map((row) => ({
            key: row.key,
            dc: row.dc,
            dcId: row.dc_id,
            since: row.since,
            lastSeenAt: row.last_seen_at,
            openedAt: row.opened_at,
            correlationId: row.correlation_id,
            findings: findings.filter((finding) => finding.incident_key === row.key).map(toFinding),
        }));
    }

    /**
     * Keeps what of `incidents` has to outlast a restart -- the reported ones and their
     * reported findings -- in place of what was kept before, in one transaction.
     */
    static replaceOpen(incidents: readonly TrackedIncident[]): void {
        const insertIncident = db.prepare(
            `INSERT INTO domain_incidents (key, dc, dc_id, since, last_seen_at, opened_at, correlation_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        const insertFinding = db.prepare(
            `INSERT INTO domain_incident_findings
               (incident_key, finding_id, type, severity, reported_severity, text, since, last_seen_at, reported_at, escalating_since)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        db.transaction(() => {
            db.prepare("DELETE FROM domain_incident_findings").run();
            db.prepare("DELETE FROM domain_incidents").run();
            for (const incident of incidents) {
                if (incident.openedAt === null || incident.correlationId === null) continue;
                insertIncident.run(
                    incident.key,
                    incident.dc,
                    incident.dcId,
                    incident.since,
                    incident.lastSeenAt,
                    incident.openedAt,
                    incident.correlationId,
                );
                for (const finding of incident.findings) {
                    if (finding.state !== "reported" || finding.reportedAt === null || finding.reportedSeverity === null) continue;
                    insertFinding.run(
                        incident.key,
                        finding.id,
                        finding.type,
                        finding.severity,
                        finding.reportedSeverity,
                        finding.text,
                        finding.since,
                        finding.lastSeenAt,
                        finding.reportedAt,
                        finding.escalatingSince,
                    );
                }
            }
        })();
    }
}
