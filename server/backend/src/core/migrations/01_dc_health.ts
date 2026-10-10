import type { MigrationContext } from "./context.js";

/**
 * The last measurement each agent sent of its domain controller. One row per client,
 * written over with every measurement -- there is no history here. What is worth looking
 * back on goes to the activity list as an event.
 *
 * `report` is the measurement as JSON. `dc_name` is the domain controller's name in the
 * directory as the last measurement that could read it gave it: it outlives a measurement
 * that could not, which is the one taken while Samba is down.
 */
export const migration01 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE dc_health (
            client_id       TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
            report          TEXT NOT NULL,
            dc_name         TEXT,
            clock_offset_ms INTEGER,
            received_at     TEXT NOT NULL
          );
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`DROP TABLE IF EXISTS dc_health;`);
    },
};
