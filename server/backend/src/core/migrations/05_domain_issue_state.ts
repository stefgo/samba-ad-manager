import type { MigrationContext } from "./context.js";

/**
 * `domain_issues` holds every finding the server tracks, not only the reported ones: a
 * finding waits (`pending`) until it has lasted long enough to be reported (`open`). The
 * wait is kept here so a restart does not start it over.
 *
 * - `seen_since` is when the finding began, over gaps too short to call it gone; `last_seen_at`
 *   when an evaluation last found it -- what the resolve wait is measured from.
 * - `opened_at` and `correlation_id` are null while a finding is pending: its row in the
 *   activity begins when it is reported.
 * - `escalating_since` is set while a reported warning has been an error for less than its wait.
 *
 * SQLite cannot drop a NOT NULL, so the table is built anew. A row already there was reported.
 */
export const migration05 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE domain_issues_new (
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
          INSERT INTO domain_issues_new (id, type, severity, dc, dc_id, text, state, seen_since, last_seen_at, opened_at, correlation_id)
            SELECT id, type, severity, dc, dc_id, text, 'open', opened_at, opened_at, opened_at, correlation_id FROM domain_issues;
          DROP TABLE domain_issues;
          ALTER TABLE domain_issues_new RENAME TO domain_issues;
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`
          DELETE FROM domain_issues WHERE state <> 'open';
          CREATE TABLE domain_issues_old (
            id             TEXT PRIMARY KEY,
            type           TEXT NOT NULL,
            severity       TEXT NOT NULL,
            dc             TEXT,
            dc_id          TEXT,
            text           TEXT NOT NULL,
            opened_at      TEXT NOT NULL,
            correlation_id TEXT NOT NULL
          );
          INSERT INTO domain_issues_old SELECT id, type, severity, dc, dc_id, text, opened_at, correlation_id FROM domain_issues;
          DROP TABLE domain_issues;
          ALTER TABLE domain_issues_old RENAME TO domain_issues;
        `);
    },
};
