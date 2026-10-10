import type { Database } from "better-sqlite3";

/**
 * What Umzug hands a migration: the open database, as `Database.ts` registers it
 * (`new Umzug<Database.Database>({ context: db })`). Declared once here so the three
 * migrations name the same type instead of each typing its own context.
 */
export type MigrationContext = { context: Database };
