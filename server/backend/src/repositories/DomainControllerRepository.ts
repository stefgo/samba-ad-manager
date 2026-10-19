import db from "../core/Database.js";

/** A row of `domain_controllers` (migrations 00 and 07). */
export interface DomainControllerRow {
    id: string;
    name: string;
    dns_host_name: string | null;
    site: string | null;
    address: string | null;
    first_seen: string;
    updated_at: string;
    /** The SHA-256 of the token an agent that dials in registers with; null while none is open. */
    agent_registration_token_hash: string | null;
    agent_registration_expires_at: string | null;
}

/** What the directory says of a domain controller. */
export interface ListedController {
    id: string;
    name: string;
    dnsHostName: string | null;
    site: string | null;
}

/**
 * The domain controllers of the domain. A row exists because the directory lists that
 * domain controller; `address` is what is set for it here.
 */
export class DomainControllerRepository {
    static findAll(): DomainControllerRow[] {
        return db.prepare("SELECT * FROM domain_controllers ORDER BY name").all() as DomainControllerRow[];
    }

    static findById(id: string): DomainControllerRow | undefined {
        return db.prepare("SELECT * FROM domain_controllers WHERE id = ?").get(id) as DomainControllerRow | undefined;
    }

    static insert(dc: ListedController, now: string): void {
        db.prepare(
            `INSERT INTO domain_controllers (id, name, dns_host_name, site, first_seen, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(dc.id, dc.name, dc.dnsHostName, dc.site, now, now);
    }

    /** What the directory says now, over what it said before. Whether anything differed. */
    static updateListed(dc: ListedController, now: string): boolean {
        return (
            db
                .prepare(
                    `UPDATE domain_controllers SET name = ?, dns_host_name = ?, site = ?, updated_at = ?
                     WHERE id = ? AND (name IS NOT ? OR dns_host_name IS NOT ? OR site IS NOT ?)`,
                )
                .run(dc.name, dc.dnsHostName, dc.site, now, dc.id, dc.name, dc.dnsHostName, dc.site).changes > 0
        );
    }

    static updateAddress(id: string, address: string | null, now: string): { changes: number } {
        return db.prepare("UPDATE domain_controllers SET address = ?, updated_at = ? WHERE id = ?").run(address, now, id);
    }

    /** The one registration token of a domain controller: setting one takes the one before away. */
    static setRegistrationToken(id: string, tokenHash: string, expiresAt: string): { changes: number } {
        return db
            .prepare("UPDATE domain_controllers SET agent_registration_token_hash = ?, agent_registration_expires_at = ? WHERE id = ?")
            .run(tokenHash, expiresAt, id);
    }

    /** The domain controller a registration token was issued for, while it is good. */
    static findByValidRegistrationToken(tokenHash: string, now: string): DomainControllerRow | undefined {
        return db
            .prepare("SELECT * FROM domain_controllers WHERE agent_registration_token_hash = ? AND agent_registration_expires_at > ?")
            .get(tokenHash, now) as DomainControllerRow | undefined;
    }

    static clearRegistrationToken(id: string): void {
        db.prepare("UPDATE domain_controllers SET agent_registration_token_hash = NULL, agent_registration_expires_at = NULL WHERE id = ?").run(
            id,
        );
    }

    /** Takes its measurement, its agent and what that reported along (ON DELETE CASCADE). */
    static delete(id: string): { changes: number } {
        return db.prepare("DELETE FROM domain_controllers WHERE id = ?").run(id);
    }
}
