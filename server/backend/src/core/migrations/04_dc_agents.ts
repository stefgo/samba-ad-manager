import type { MigrationContext } from "./context.js";

/**
 * The agents: the process a domain controller may run in its container, and what it reports.
 *
 * - `dc_agents` holds at most one agent per domain controller, and goes with it. The auth
 *   token is kept as its SHA-256 only. An agent the server dials (`outbound`) has to be
 *   shown the token again on every connection, so that one is derived from `token_nonce`
 *   and the server's own secret each time instead of being stored.
 * - `agent_registration_tokens` are what an agent that dials in registers with: issued for
 *   one domain controller, good once and for an hour. Hashed, like every token here.
 * - `dc_local` is the agent's last report of what it reads locally, as JSON -- a third table
 *   next to `dc_health` and `dc_dbcheck`, because the three arrive independently.
 */
export const migration04 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE dc_agents (
            dc_id           TEXT PRIMARY KEY REFERENCES domain_controllers(id) ON DELETE CASCADE,
            connection_mode TEXT NOT NULL,
            auth_token_hash TEXT NOT NULL,
            token_nonce     TEXT,
            target_address  TEXT,
            hostname        TEXT,
            version         TEXT,
            capabilities    TEXT NOT NULL DEFAULT '[]',
            registered_at   TEXT NOT NULL,
            last_seen       TEXT
          );

          CREATE TABLE agent_registration_tokens (
            token_hash TEXT PRIMARY KEY,
            dc_id      TEXT NOT NULL REFERENCES domain_controllers(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
          );

          CREATE TABLE dc_local (
            dc_id       TEXT PRIMARY KEY REFERENCES domain_controllers(id) ON DELETE CASCADE,
            report      TEXT NOT NULL,
            received_at TEXT NOT NULL
          );
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`
          DROP TABLE IF EXISTS dc_local;
          DROP TABLE IF EXISTS agent_registration_tokens;
          DROP TABLE IF EXISTS dc_agents;
        `);
    },
};
