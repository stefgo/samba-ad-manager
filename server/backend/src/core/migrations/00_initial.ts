import type { MigrationContext } from "./context.js";

/**
 * The schema sadm starts from: the logins of this application, the domain controllers of the
 * domain it manages, the activity log, the schedulers and the webhooks.
 *
 * - `users.token_version` is carried by every session token as `tv`; raising it ends every
 *   session the user has.
 * - `domain_controllers.id` is the `objectGUID` of the domain controller's NTDS settings:
 *   what replication names a partner by, and what the database check reports itself as. A
 *   row is what the directory lists; `address` is the one thing an operator sets.
 * - `domain_controllers.report_token_hash` is the SHA-256 of the token the domain
 *   controller's database check is reported with, never the token.
 * - `activity.dc_id` is not a foreign key: an event about a domain controller outlives it.
 * - `activity_seen` holds one row per event and user, cleared away with either.
 * - `scheduler_state` holds one row per scheduler, written over on every run.
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

          CREATE TABLE IF NOT EXISTS domain_controllers (
            id                      TEXT PRIMARY KEY,
            name                    TEXT NOT NULL,
            dns_host_name           TEXT,
            site                    TEXT,
            address                 TEXT,
            report_token_hash       TEXT UNIQUE,
            report_token_created_at TEXT,
            first_seen              TEXT NOT NULL,
            updated_at              TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS activity (
            id             TEXT PRIMARY KEY,
            dc_id          TEXT,
            kind           TEXT NOT NULL,
            level          TEXT NOT NULL,
            correlation_id TEXT,
            subject        TEXT,
            data           TEXT,
            occurred_at    TEXT NOT NULL
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
          DROP TABLE IF EXISTS domain_controllers;
          DROP TABLE IF EXISTS users;
        `);
    },
};
