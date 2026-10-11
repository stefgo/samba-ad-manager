import type { MigrationContext } from "./context.js";

/**
 * The findings about the domain that have been announced and not yet called off. Kept so
 * that a restart neither announces them a second time nor forgets to call them off -- and
 * so the all-clear can say how long the finding lasted and carry the id of its announcement.
 *
 * Nothing else is stored about a finding: what is wrong right now is derived from the
 * measurements, every time.
 */
export const migration02 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE domain_issues (
            id             TEXT PRIMARY KEY,
            type           TEXT NOT NULL,
            severity       TEXT NOT NULL,
            dc             TEXT,
            dc_id          TEXT,
            text           TEXT NOT NULL,
            opened_at      TEXT NOT NULL,
            correlation_id TEXT NOT NULL
          );
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`DROP TABLE IF EXISTS domain_issues;`);
    },
};
