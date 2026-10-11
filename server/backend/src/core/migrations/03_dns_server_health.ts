import type { MigrationContext } from "./context.js";

/**
 * What is known of each name server of the domain that is no domain controller: a
 * secondary that transfers a zone. One row per server, written over every time it is asked.
 *
 * Stored rather than kept in memory because of one thing in it: since when a secondary has
 * been out of step with the domain controllers. A restart that forgot that would start the
 * wait again, and a secondary that has not transferred for a day would be fine for another
 * half hour.
 *
 * No reference to `domain_controllers`: these are the servers that are none.
 */
export const migration03 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE dns_server_health (
            name        TEXT PRIMARY KEY,
            health      TEXT NOT NULL,
            measured_at TEXT NOT NULL
          );
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`DROP TABLE IF EXISTS dns_server_health;`);
    },
};
