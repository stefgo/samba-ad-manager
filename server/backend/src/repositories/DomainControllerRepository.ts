import db from "../core/Database.js";

/** A row of `domain_controllers` (migration 00). */
export interface DomainControllerRow {
    id: string;
    name: string;
    dns_host_name: string | null;
    site: string | null;
    address: string | null;
    report_token_hash: string | null;
    report_token_created_at: string | null;
    first_seen: string;
    updated_at: string;
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
 * domain controller; `address` and the report token are what is set for it here.
 */
export class DomainControllerRepository {
    static findAll(): DomainControllerRow[] {
        return db.prepare("SELECT * FROM domain_controllers ORDER BY name").all() as DomainControllerRow[];
    }

    static findById(id: string): DomainControllerRow | undefined {
        return db.prepare("SELECT * FROM domain_controllers WHERE id = ?").get(id) as DomainControllerRow | undefined;
    }

    static findByReportTokenHash(hash: string): DomainControllerRow | undefined {
        return db.prepare("SELECT * FROM domain_controllers WHERE report_token_hash = ?").get(hash) as
            | DomainControllerRow
            | undefined;
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

    /** Sets the report token, or takes it away with two nulls. */
    static setReportToken(id: string, hash: string | null, createdAt: string | null): { changes: number } {
        return db
            .prepare("UPDATE domain_controllers SET report_token_hash = ?, report_token_created_at = ? WHERE id = ?")
            .run(hash, createdAt, id);
    }

    /** Takes its measurement and its database check along (ON DELETE CASCADE). */
    static delete(id: string): { changes: number } {
        return db.prepare("DELETE FROM domain_controllers WHERE id = ?").run(id);
    }
}
