import type { MigrationContext } from "./context.js";

/**
 * What is known about the health of each domain controller. One row per domain controller,
 * written over every time -- there is no history here. What is worth looking back on goes to
 * the activity list as an event.
 *
 * `dc_health` is the last measurement the server took, as JSON. `dc_dbcheck` is the last
 * database check the domain controller reported: a table of its own, because a report
 * arrives on the domain controller's schedule and not with a measurement.
 */
export const migration01 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE dc_health (
            dc_id       TEXT PRIMARY KEY REFERENCES domain_controllers(id) ON DELETE CASCADE,
            measurement TEXT NOT NULL,
            measured_at TEXT NOT NULL
          );

          CREATE TABLE dc_dbcheck (
            dc_id       TEXT PRIMARY KEY REFERENCES domain_controllers(id) ON DELETE CASCADE,
            report      TEXT NOT NULL,
            received_at TEXT NOT NULL
          );
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`
          DROP TABLE IF EXISTS dc_dbcheck;
          DROP TABLE IF EXISTS dc_health;
        `);
    },
};
