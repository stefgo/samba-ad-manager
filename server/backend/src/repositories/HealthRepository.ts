import db from "../core/Database.js";

/**
 * The liveness probe's view of the database. `SELECT 1` touches no table, so the check
 * stays true regardless of which migrations have run.
 */
export class HealthRepository {
    /** Throws if the connection cannot answer. */
    static check(): void {
        db.prepare("SELECT 1").get();
    }
}
