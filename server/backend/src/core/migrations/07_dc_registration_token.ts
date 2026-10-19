import type { MigrationContext } from "./context.js";

/**
 * The registration token of an agent becomes a property of its domain controller.
 *
 * There was never more than one per domain controller -- issuing one took the one before
 * away -- so a table of its own was a list nobody needed. Two columns on
 * `domain_controllers` hold it now: the token's SHA-256 (unique, it is what a registering
 * agent is found by) and when it expires. Both are null while no token is open. A token
 * still good is carried over; an expired one is dropped with the table.
 */
export const migration07 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          ALTER TABLE domain_controllers ADD COLUMN agent_registration_token_hash TEXT;
          ALTER TABLE domain_controllers ADD COLUMN agent_registration_expires_at TEXT;
          CREATE UNIQUE INDEX idx_domain_controllers_registration_token
            ON domain_controllers(agent_registration_token_hash);
        `);
        db.prepare(
            `UPDATE domain_controllers
             SET agent_registration_token_hash = t.token_hash, agent_registration_expires_at = t.expires_at
             FROM agent_registration_tokens AS t
             WHERE t.dc_id = domain_controllers.id AND t.expires_at > ?`,
        ).run(new Date().toISOString());
        db.exec("DROP TABLE agent_registration_tokens;");
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE agent_registration_tokens (
            token_hash TEXT PRIMARY KEY,
            dc_id      TEXT NOT NULL REFERENCES domain_controllers(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
          );
        `);
        db.prepare(
            `INSERT INTO agent_registration_tokens (token_hash, dc_id, created_at, expires_at)
             SELECT agent_registration_token_hash, id, ?, agent_registration_expires_at FROM domain_controllers
             WHERE agent_registration_token_hash IS NOT NULL`,
        ).run(new Date().toISOString());
        db.exec(`
          DROP INDEX IF EXISTS idx_domain_controllers_registration_token;
          ALTER TABLE domain_controllers DROP COLUMN agent_registration_expires_at;
          ALTER TABLE domain_controllers DROP COLUMN agent_registration_token_hash;
        `);
    },
};
