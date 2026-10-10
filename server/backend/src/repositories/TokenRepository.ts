import crypto from "crypto";
import db from "../core/Database.js";

/**
 * How a registration token is stored and looked up. The value itself is shown once, when it
 * is issued; the table only holds its SHA-256 hash, which the list shows in its place.
 */
export function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** A row of the `registration_tokens` table. */
export interface RegistrationTokenRow {
    /** SHA-256 of the token, hex. The token itself is never stored. */
    token_hash: string;
    created_at: string;
    expires_at: string | null;
    used_at: string | null;
    /** Name the client is created under. Null means the agent's hostname is used. */
    display_name: string | null;
    /** Address or network the client is restricted to. Null means the registering address. */
    allowed_ip: string | null;
}

export class TokenRepository {
    static findAll(): RegistrationTokenRow[] {
        return db
            .prepare(
                "SELECT * FROM registration_tokens ORDER BY created_at DESC",
            )
            .all() as RegistrationTokenRow[];
    }

    static findValidByToken(token: string): RegistrationTokenRow | undefined {
        return db
            .prepare(
                "SELECT * FROM registration_tokens WHERE token_hash = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')",
            )
            .get(hashToken(token)) as RegistrationTokenRow | undefined;
    }

    /**
     * Stores a new registration token together with what the operator already knows about
     * the client it is meant for. Both defaults are optional; null keeps the behaviour the
     * token had before they existed.
     */
    static create(
        token: string,
        expiresAt: string,
        displayName: string | null = null,
        allowedIp: string | null = null,
    ): void {
        db.prepare(
            "INSERT INTO registration_tokens (token_hash, expires_at, display_name, allowed_ip) VALUES (?, ?, ?, ?)",
        ).run(hashToken(token), expiresAt, displayName, allowedIp);
    }

    static markUsed(tokenHash: string): { changes: number } {
        return db
            .prepare(
                "UPDATE registration_tokens SET used_at = datetime('now') WHERE token_hash = ?",
            )
            .run(tokenHash);
    }

    static delete(tokenHash: string): { changes: number } {
        return db
            .prepare("DELETE FROM registration_tokens WHERE token_hash = ?")
            .run(tokenHash);
    }

    /**
     * Removes registration tokens that have become invalid (used or expired)
     * and whose invalidation timestamp is older than the given TTL in days.
     *
     * An invalid token is considered invalidated at COALESCE(used_at, expires_at). Both go
     * through datetime(): `expires_at` is written as ISO text, `used_at` by SQLite itself,
     * and compared as plain strings the two formats disagree within the same day.
     */
    static cleanupInvalidTokens(ttlDays: number): number {
        const days = Number.isFinite(ttlDays) && ttlDays >= 0 ? Math.floor(ttlDays) : 0;

        const result = db.prepare(`
            DELETE FROM registration_tokens
            WHERE (used_at IS NOT NULL OR datetime(expires_at) <= datetime('now'))
              AND datetime(COALESCE(used_at, expires_at)) < datetime('now', ?)
        `).run(`-${days} days`);
        return result.changes;
    }
}
