import db from "../core/Database.js";

/**
 * A row of the `users` table. `id` is INTEGER AUTOINCREMENT, hence a number. The route
 * parameter it is compared with is a string, which is why the finders take one.
 */
export interface UserRow {
    id: number;
    username: string | null;
    /** Null for an account that signs in through OIDC only. */
    password_hash: string | null;
    auth_methods: string | null;
    /** Carried by every session token as `tv`; raising it ends all of the user's sessions. */
    token_version: number;
    created_at: string;
    updated_at: string | null;
}

/** What findAll selects -- password_hash is deliberately not among the columns. */
export type UserListRow = Omit<UserRow, "password_hash">;

export class UserRepository {
    static countAll(): number {
        const result = db
            .prepare("SELECT COUNT(*) as count FROM users")
            .get() as { count: number };
        return result.count;
    }

    static findAll(): UserListRow[] {
        return db
            .prepare(
                "SELECT id, username, auth_methods, created_at, updated_at FROM users",
            )
            .all() as UserListRow[];
    }

    static findByUsername(username: string): UserRow | undefined {
        return db
            .prepare("SELECT * FROM users WHERE username = ?")
            .get(username) as UserRow | undefined;
    }

    static findById(id: string): UserRow | undefined {
        return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
            | UserRow
            | undefined;
    }

    static create(
        username: string,
        passwordHash: string | null,
        authMethods: string,
    ): void {
        db.prepare(
            "INSERT INTO users (username, password_hash, auth_methods) VALUES (?, ?, ?)",
        ).run(username, passwordHash, authMethods);
    }

    /** Also ends every session of the user: a token signed under the old password must not outlive it. */
    static updatePassword(id: string, passwordHash: string): void {
        db.prepare(
            "UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        ).run(passwordHash, id);
    }

    /**
     * Ends the user's sessions only when the value actually changes: the user form sends
     * `auth_methods` on every save, and an unchanged value revokes nothing.
     */
    static updateAuthMethods(id: string, authMethods: string): void {
        db.prepare(
            `UPDATE users SET auth_methods = ?,
                token_version = token_version + (COALESCE(auth_methods, '') <> ?),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
        ).run(authMethods, authMethods, id);
    }

    static delete(id: string): { changes: number } {
        return db.prepare("DELETE FROM users WHERE id = ?").run(id);
    }
}
