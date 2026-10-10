import db from "../core/Database.js";
import type { ConnectionMode } from "@sadm/shared";
import { hashToken } from "./TokenRepository.js";
import { decryptSecret, encryptSecret } from "../services/SecretCrypto.js";

/**
 * A row of the `clients` table (migration 00). Deliberately not the shared
 * `Client` type: that one is camelCase and derived from Zod, these are the raw snake_case
 * columns, and ProxyService does the mapping between them.
 */
export interface ClientRow {
    id: string;
    hostname: string | null;
    display_name: string | null;
    /** The location the operator put the client in; null means no site. */
    site: string | null;
    /**
     * Never the token itself. Inbound: its SHA-256 hash, because the server
     * only has to recognise the token an agent presents. Outbound: encrypted with
     * SecretCrypto, because the server presents it itself when it dials -- read it with
     * outboundAuthToken().
     */
    auth_token: string | null;
    connection_mode: ConnectionMode;
    /**
     * Inbound clients only: the address or IPv4 network their connections must come from.
     * Starts out as the address the agent registered from; null means the check is off.
     */
    inbound_allowed_ip: string | null;
    /** Outbound clients only: the host:port the server dials. */
    outbound_target_address: string | null;
    /**
     * Inbound clients only: the address the agent last authenticated from. Nothing decides
     * on it -- it is written after the allowed-address check has passed, so it is always an
     * address that was let in, and it exists so the client editor can say what
     * `inbound_allowed_ip` is about to be measured against.
     */
    inbound_last_ip: string | null;
    version: string | null;
    last_seen: string | null;
    created_at: string;
    updated_at: string | null;
}

export class ClientRepository {
    static findAll(): ClientRow[] {
        return db.prepare("SELECT * FROM clients").all() as ClientRow[];
    }

    static findById(id: string): ClientRow | undefined {
        return db.prepare("SELECT * FROM clients WHERE id = ?").get(id) as
            | ClientRow
            | undefined;
    }

    /**
     * Resolves the identity an agent presents when it connects. Both halves have to match
     * the same row: the id alone is no secret -- it stands in every dashboard URL -- and the
     * token alone used to make a client whoever its token happened to belong to, so a token
     * copied to the wrong host took over that host's row. Narrower than the other finders,
     * because this runs on every agent connect.
     *
     * The stored value is a hash, so the comparison runs on the hash of what was presented.
     * An outbound client's encrypted token never matches -- it has no business connecting
     * inbound.
     */
    static findByIdAndToken(
        id: string,
        token: string,
    ): Pick<ClientRow, "id" | "inbound_allowed_ip" | "connection_mode"> | undefined {
        return db
            .prepare(
                "SELECT id, inbound_allowed_ip, connection_mode FROM clients WHERE id = ? AND auth_token = ?",
            )
            .get(id, hashToken(token)) as
            | Pick<ClientRow, "id" | "inbound_allowed_ip" | "connection_mode">
            | undefined;
    }

    static findOutboundClients(): ClientRow[] {
        return db
            .prepare("SELECT * FROM clients WHERE connection_mode = 'outbound'")
            .all() as ClientRow[];
    }

    /**
     * Creates an inbound client. A plain INSERT, deliberately: this used to be an upsert on
     * the id the agent sent, which let a caller holding a registration token name an
     * existing client and have its auth token replaced. The server picks the id now, so a
     * collision is a bug and should fail loudly.
     */
    static createInbound(
        id: string,
        hostname: string,
        authToken: string,
        allowedIp: string,
    ): void {
        db.prepare(`
            INSERT INTO clients (id, hostname, auth_token, inbound_allowed_ip, connection_mode, last_seen)
            VALUES (?, ?, ?, ?, 'inbound', datetime('now'))
        `).run(id, hostname, hashToken(authToken), allowedIp);
    }

    static createOutbound(
        id: string,
        hostname: string,
        outboundTargetAddress: string,
        authToken: string,
    ): void {
        db.prepare(`
            INSERT INTO clients (id, hostname, outbound_target_address, auth_token, connection_mode, last_seen)
            VALUES (?, ?, ?, ?, 'outbound', datetime('now'))
        `).run(id, hostname, outboundTargetAddress, encryptSecret(authToken));
    }

    /**
     * The auth token the server presents to an outbound client, decrypted. Throws if it
     * cannot be decrypted (usually a changed secretKey).
     */
    static outboundAuthToken(client: ClientRow): string | null {
        return client.auth_token ? decryptSecret(client.auth_token) : null;
    }

    static updateDisplayName(
        id: string,
        displayName: string,
    ): { changes: number } {
        return db
            .prepare("UPDATE clients SET display_name = ? WHERE id = ?")
            .run(displayName, id);
    }

    static updateSite(id: string, site: string | null): { changes: number } {
        return db
            .prepare("UPDATE clients SET site = ?, updated_at = datetime('now') WHERE id = ?")
            .run(site, id);
    }

    /**
     * Changes where an inbound client's connections must come from; null switches the check
     * off. Restricted to inbound rows in SQL as well: an outbound client is dialled by the
     * server and never checked against an address.
     */
    static updateInboundAllowedIp(
        id: string,
        allowedIp: string | null,
    ): { changes: number } {
        return db
            .prepare(
                "UPDATE clients SET inbound_allowed_ip = ?, updated_at = datetime('now') WHERE id = ? AND connection_mode = 'inbound'",
            )
            .run(allowedIp, id);
    }

    /**
     * Changes where the server dials an outbound client. Restricted to outbound rows in SQL
     * as well, mirroring updateInboundAllowedIp: an inbound client is never dialled, so an
     * address stored on one would be a value nothing reads.
     */
    static updateOutboundTargetAddress(
        id: string,
        targetAddress: string,
    ): { changes: number } {
        return db
            .prepare(
                "UPDATE clients SET outbound_target_address = ?, updated_at = datetime('now') WHERE id = ? AND connection_mode = 'outbound'",
            )
            .run(targetAddress, id);
    }

    /**
     * Stores the token of an outbound client that registered again, encrypted like the one
     * createOutbound stored. Restricted to outbound rows in SQL: an inbound token is a hash,
     * and writing an encrypted value there would lock its agent out.
     */
    static updateOutboundAuthToken(id: string, authToken: string): void {
        db.prepare(
            "UPDATE clients SET auth_token = ?, updated_at = datetime('now') WHERE id = ? AND connection_mode = 'outbound'",
        ).run(encryptSecret(authToken), id);
    }

    /**
     * `lastIp` is the address the agent connected from, and only an inbound agent has one:
     * in outbound mode the server is the calling party, so the caller passes null there.
     * COALESCE rather than a plain assignment, so null leaves the stored address alone
     * instead of erasing the one piece of evidence the client editor has.
     */
    static updateAuthSuccess(
        id: string,
        version: string | null,
        lastIp: string | null,
    ): void {
        const now = new Date().toISOString();
        db.prepare(
            "UPDATE clients SET last_seen=?, updated_at=?, version=?, inbound_last_ip=COALESCE(?, inbound_last_ip) WHERE id=?",
        ).run(now, now, version, lastIp, id);
    }

    /**
     * Called when a connection closes, so now is the last moment the agent was seen.
     * Without `last_seen` the field would keep the time the agent connected, and a client
     * that held the connection for a month would read "last seen 30 days ago" the second
     * it drops -- the one moment the field is actually looked at.
     */
    static updateLastSeen(id: string): void {
        const now = new Date().toISOString();
        db.prepare("UPDATE clients SET last_seen=?, updated_at=? WHERE id = ?").run(
            now,
            now,
            id,
        );
    }

    static delete(id: string): { changes: number } {
        return db.prepare("DELETE FROM clients WHERE id = ?").run(id);
    }
}
