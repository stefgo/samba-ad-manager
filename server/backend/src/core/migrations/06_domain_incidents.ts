import type { MigrationContext } from "./context.js";

/**
 * The findings are reported as incidents, one per domain controller and one for the domain,
 * and only what has to outlast a restart is kept: the incidents that were reported and have
 * not had their all-clear, with the findings reported in them. Without it a restart would
 * report them a second time and never call the first report off.
 *
 * Everything else -- the findings still waiting, what each went through -- is the server's
 * memory, and a restart begins it again. `domain_issues` is dropped with what it held: the
 * incidents start from what the next measurements find.
 *
 * - `domain_incidents.key` is the domain controller's id, or `domain`.
 * - `domain_incident_findings.severity` is how the finding was last found, `reported_severity`
 *   how it was reported or last escalated; `escalating_since` is set while a reported warning
 *   has been an error for less than its wait.
 * - A finding's rows go with its incident's; `DomainIncidentRepository` deletes both, as
 *   SQLite enforces no foreign key here.
 */
export const migration06 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          DROP TABLE domain_issues;
          CREATE TABLE domain_incidents (
            key            TEXT PRIMARY KEY,
            dc             TEXT,
            dc_id          TEXT,
            since          TEXT NOT NULL,
            last_seen_at   TEXT NOT NULL,
            opened_at      TEXT NOT NULL,
            correlation_id TEXT NOT NULL
          );
          CREATE TABLE domain_incident_findings (
            incident_key      TEXT NOT NULL,
            finding_id        TEXT NOT NULL,
            type              TEXT NOT NULL,
            severity          TEXT NOT NULL,
            reported_severity TEXT NOT NULL,
            text              TEXT NOT NULL,
            since             TEXT NOT NULL,
            last_seen_at      TEXT NOT NULL,
            reported_at       TEXT NOT NULL,
            escalating_since  TEXT,
            PRIMARY KEY (incident_key, finding_id)
          );
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`
          DROP TABLE domain_incident_findings;
          DROP TABLE domain_incidents;
          CREATE TABLE domain_issues (
            id               TEXT PRIMARY KEY,
            type             TEXT NOT NULL,
            severity         TEXT NOT NULL,
            dc               TEXT,
            dc_id            TEXT,
            text             TEXT NOT NULL,
            state            TEXT NOT NULL,
            seen_since       TEXT NOT NULL,
            last_seen_at     TEXT NOT NULL,
            opened_at        TEXT,
            correlation_id   TEXT,
            escalating_since TEXT
          );
        `);
    },
};
