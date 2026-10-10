import type { MigrationContext } from "./context.js";

/**
 * The schema sadm starts from: where keepalived-status-monitor's migrations 00-11 had
 * brought users, clients, registration tokens, the activity log, the schedulers and the
 * webhooks, without the keepalived and VRRP tables -- a fresh history rather than twelve
 * steps nobody here ever ran.
 *
 * What those steps settled, and this schema therefore starts with:
 *
 * - `registration_tokens.token_hash` is the SHA-256 of the token, never the token.
 * - `clients.auth_token` is the SHA-256 of an inbound client's token, and an outbound
 *   client's token encrypted with `secretKey` -- the server presents that one itself.
 * - `users.token_version` is carried by every session token as `tv`; raising it ends every
 *   session the user has.
 * - `activity_seen` holds one row per event and user, cleared away with either.
 * - `scheduler_state` holds one row per scheduler, written over on every run.
 *
 * A migration must not depend on today's code, so the connection-mode literal is spelled
 * out instead of read from CONNECTION_MODE.
 */
export const migration00 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            auth_methods TEXT DEFAULT 'local',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            token_version INTEGER NOT NULL DEFAULT 0
          );

          CREATE TABLE IF NOT EXISTS clients (
            id TEXT PRIMARY KEY,
            hostname TEXT,
            display_name TEXT,
            auth_token TEXT UNIQUE,
            connection_mode TEXT NOT NULL DEFAULT 'inbound',
            inbound_allowed_ip TEXT,
            inbound_last_ip TEXT,
            outbound_target_address TEXT,
            version TEXT,
            last_seen DATETIME,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            site TEXT
          );

          CREATE TABLE IF NOT EXISTS registration_tokens (
            token_hash TEXT PRIMARY KEY,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            used_at DATETIME,
            display_name TEXT,
            allowed_ip TEXT
          );

          CREATE TABLE IF NOT EXISTS activity (
            id             TEXT PRIMARY KEY,
            source         TEXT NOT NULL,
            client_id      TEXT,
            kind           TEXT NOT NULL,
            level          TEXT NOT NULL,
            correlation_id TEXT,
            subject        TEXT,
            data           TEXT,
            occurred_at    TEXT NOT NULL,
            received_at    TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS activity_corr     ON activity (correlation_id);
          CREATE INDEX IF NOT EXISTS activity_occurred ON activity (occurred_at DESC);

          CREATE TABLE IF NOT EXISTS activity_seen (
            activity_id TEXT    NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
            user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
            PRIMARY KEY (activity_id, user_id)
          ) WITHOUT ROWID;

          CREATE TABLE IF NOT EXISTS scheduler_state (
            scheduler        TEXT PRIMARY KEY,
            running_since    TEXT,
            running_trigger  TEXT,
            last_started_at  TEXT,
            last_finished_at TEXT,
            last_trigger     TEXT,
            last_status      TEXT,
            last_result      TEXT,
            last_error       TEXT,
            state            TEXT,
            next_run_at      TEXT
          );

          CREATE TABLE IF NOT EXISTS webhooks (
            id              TEXT    PRIMARY KEY,
            name            TEXT    NOT NULL,
            enabled         INTEGER NOT NULL DEFAULT 1,
            url             TEXT    NOT NULL,
            method          TEXT    NOT NULL DEFAULT 'POST',
            headers         TEXT    NOT NULL DEFAULT '{}',
            body_template   TEXT    NOT NULL,
            min_level       TEXT    NOT NULL DEFAULT 'warning',
            kinds           TEXT    NOT NULL DEFAULT '[]',
            timeout_ms      INTEGER NOT NULL DEFAULT 10000,
            last_status     INTEGER,
            last_error      TEXT,
            last_attempt_at TEXT,
            created_at      TEXT    NOT NULL,
            updated_at      TEXT
          );
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`
          DROP TABLE IF EXISTS webhooks;
          DROP TABLE IF EXISTS scheduler_state;
          DROP TABLE IF EXISTS activity_seen;
          DROP TABLE IF EXISTS activity;
          DROP TABLE IF EXISTS registration_tokens;
          DROP TABLE IF EXISTS clients;
          DROP TABLE IF EXISTS users;
        `);
    },
};
