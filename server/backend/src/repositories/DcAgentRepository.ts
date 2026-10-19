import db from "../core/Database.js";

/** A row of `dc_agents` (migration 04). `capabilities` is a JSON array. */
export interface DcAgentRow {
    dc_id: string;
    connection_mode: string;
    auth_token_hash: string;
    token_nonce: string | null;
    target_address: string | null;
    hostname: string | null;
    version: string | null;
    capabilities: string;
    registered_at: string;
    last_seen: string | null;
}

/** What a registration writes. An agent that registers again replaces the one before it. */
export type NewDcAgent = Pick<
    DcAgentRow,
    "dc_id" | "connection_mode" | "auth_token_hash" | "token_nonce" | "target_address" | "hostname" | "registered_at"
>;

/** The agents of the domain controllers: at most one each. */
export class DcAgentRepository {
    static findAll(): DcAgentRow[] {
        return db.prepare("SELECT * FROM dc_agents").all() as DcAgentRow[];
    }

    static find(dcId: string): DcAgentRow | undefined {
        return db.prepare("SELECT * FROM dc_agents WHERE dc_id = ?").get(dcId) as DcAgentRow | undefined;
    }

    static save(agent: NewDcAgent): void {
        db.prepare(
            `INSERT INTO dc_agents (dc_id, connection_mode, auth_token_hash, token_nonce, target_address, hostname, registered_at)
             VALUES (@dc_id, @connection_mode, @auth_token_hash, @token_nonce, @target_address, @hostname, @registered_at)
             ON CONFLICT(dc_id) DO UPDATE SET
                connection_mode = excluded.connection_mode,
                auth_token_hash = excluded.auth_token_hash,
                token_nonce = excluded.token_nonce,
                target_address = excluded.target_address,
                hostname = excluded.hostname,
                version = NULL,
                capabilities = '[]',
                registered_at = excluded.registered_at,
                last_seen = NULL`,
        ).run(agent);
    }

    /** What an agent said of itself when it connected. */
    static updateConnected(dcId: string, hostname: string, version: string | null, capabilities: string[], now: string): void {
        db.prepare("UPDATE dc_agents SET hostname = ?, version = ?, capabilities = ?, last_seen = ? WHERE dc_id = ?").run(
            hostname,
            version,
            JSON.stringify(capabilities),
            now,
            dcId,
        );
    }

    /** Where the server dials an agent it reaches itself. */
    static updateTargetAddress(dcId: string, targetAddress: string): void {
        db.prepare("UPDATE dc_agents SET target_address = ? WHERE dc_id = ?").run(targetAddress, dcId);
    }

    static updateLastSeen(dcId: string, now: string): void {
        db.prepare("UPDATE dc_agents SET last_seen = ? WHERE dc_id = ?").run(now, dcId);
    }

    static delete(dcId: string): { changes: number } {
        return db.prepare("DELETE FROM dc_agents WHERE dc_id = ?").run(dcId);
    }
}
