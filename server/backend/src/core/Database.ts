import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Assuming process.cwd() is project root or server root.
// If run from workspace root: server/data
// If run from server dir: data
// Let's make it robust: relative to this file
import { fileURLToPath } from "url";
import { logger } from "@sadm/shared/node";
import { Umzug } from "umzug";
import { migration00 } from "./migrations/00_initial.js";
import { migration01 } from "./migrations/01_dc_health.js";
import { migration02 } from "./migrations/02_domain_issues.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src/core -> server/data
const DATA_DIR = path.resolve(__dirname, "../../data");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// The image runs the server as UID 1000. A data directory that UID cannot write -- one
// started with its own `user:` over a volume that belongs to root -- would otherwise
// surface as SQLite's "attempt to write a readonly database" at the first migration.
try {
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch {
    throw new Error(
        `${DATA_DIR} is not writable by UID ${process.getuid?.() ?? "?"} — give that user the directory (chown -R) and restart.`,
    );
}

const dbPath = path.join(DATA_DIR, "server.db");
const db = new Database(dbPath);
logger.info(`Database opened: ${dbPath}`);

// Enable WAL mode for better concurrency
db.pragma("journal_mode = WAL");

// Run umzug migrations
const migrator = new Umzug<Database.Database>({
    migrations: [
        { name: "00_initial", up: migration00.up, down: migration00.down },
        { name: "01_dc_health", up: migration01.up, down: migration01.down },
        { name: "02_domain_issues", up: migration02.up, down: migration02.down },
    ],
    context: db,
    storage: {
        async executed({ context }) {
            context.exec(
                `CREATE TABLE IF NOT EXISTS umzug_migrations (name TEXT PRIMARY KEY)`,
            );
            return (
                context
                    .prepare("SELECT name FROM umzug_migrations")
                    .all() as { name: string }[]
            ).map((r) => r.name);
        },
        async logMigration({ name, context }) {
            context
                .prepare("INSERT INTO umzug_migrations (name) VALUES (?)")
                .run(name);
        },
        async unlogMigration({ name, context }) {
            context
                .prepare("DELETE FROM umzug_migrations WHERE name = ?")
                .run(name);
        },
    },
    logger: console,
});

export async function initDatabase() {
    try {
        await migrator.up();
        logger.info("Database migrations executed successfully.");
    } catch (e) {
        logger.error({ err: e }, "Failed to run database migrations");
        throw e; // Rethrow to allow app to fail fast
    }
}

export default db;
