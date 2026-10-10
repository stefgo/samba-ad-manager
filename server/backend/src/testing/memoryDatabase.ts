import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import Database from "better-sqlite3";
import type { MigrationContext } from "../core/migrations/context.js";

type Migration = { up: (context: MigrationContext) => Promise<void> };

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../core/migrations");

/**
 * An empty database in memory, brought to the current schema by the real migrations.
 *
 * For tests only (the build leaves this directory out). `core/Database.ts` opens
 * `server/data/server.db` the moment it is imported, so a repository test replaces that
 * module with what this returns:
 *
 *     vi.mock("../core/Database.js", async () => {
 *         const { migratedMemoryDatabase } = await import("../testing/memoryDatabase.js");
 *         return { default: await migratedMemoryDatabase() };
 *     });
 *
 * The migrations are read from their directory in file-name order, which is the order
 * `Database.ts` lists them in -- so a new migration is part of every test without being
 * named here.
 */
export async function migratedMemoryDatabase(): Promise<Database.Database> {
    const db = new Database(":memory:");
    // Umzug's own bookkeeping, as `Database.ts` sets it up. A migration may reach into it.
    db.exec("CREATE TABLE umzug_migrations (name TEXT PRIMARY KEY)");
    const logMigration = db.prepare("INSERT INTO umzug_migrations (name) VALUES (?)");
    const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((file) => /^\d+_.*\.ts$/.test(file) && !file.endsWith(".test.ts"))
        .sort();
    for (const file of files) {
        const module: Record<string, unknown> = await import(pathToFileURL(path.join(MIGRATIONS_DIR, file)).href);
        const migration = Object.values(module).find(
            (value): value is Migration =>
                typeof value === "object" && value !== null && typeof (value as Migration).up === "function",
        );
        if (!migration) throw new Error(`${file} exports no migration`);
        await migration.up({ context: db });
        logMigration.run(file.replace(/\.ts$/, ""));
    }
    return db;
}
