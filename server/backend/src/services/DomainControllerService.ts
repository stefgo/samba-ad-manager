import crypto from "crypto";
import { WS_EVENTS, type CreatedReportToken, type DirectoryDc, type DomainController } from "@sadm/shared";
import { logger } from "../core/logger.js";
import { DcConnections } from "../dc/DcConnections.js";
import { DomainControllerRepository, type DomainControllerRow } from "../repositories/DomainControllerRepository.js";
import { ActivityService } from "./ActivityService.js";
import { DashboardHub } from "./DashboardHub.js";
import { DcHealthService } from "./DcHealthService.js";

const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

const toView = (row: DomainControllerRow): DomainController => ({
    id: row.id,
    name: row.name,
    dnsHostName: row.dns_host_name,
    site: row.site,
    address: row.address,
    dbcheckSince: row.report_token_hash ? row.report_token_created_at : null,
    firstSeen: row.first_seen,
});

/**
 * The domain controllers of the domain, as this server keeps them. Which ones there are is
 * the directory's to say: `sync` brings the table in line with what it lists. What is set
 * here is only where one is reached, and the token its database check is reported with.
 */
export class DomainControllerService {
    private static listeners: (() => void)[] = [];

    /** Told whenever the list or one of its entries changed. */
    static onChange(listener: () => void): void {
        this.listeners.push(listener);
    }

    private static changed(): void {
        DashboardHub.broadcast({ type: WS_EVENTS.DOMAIN_CONTROLLERS_UPDATE, payload: this.list() });
        for (const listener of this.listeners) listener();
    }

    static list(): DomainController[] {
        return DomainControllerRepository.findAll().map(toView);
    }

    static get(id: string): DomainController | null {
        const row = DomainControllerRepository.findById(id);
        return row ? toView(row) : null;
    }

    /**
     * Brings the table in line with the domain controllers the directory lists: a new one is
     * added, one that is no longer listed is removed with what was known of it. Each is
     * recorded in the activity -- a domain controller that joins or leaves is not routine.
     *
     * Only ever called with a list that was read: a directory that does not answer says
     * nothing about who its domain controllers are.
     */
    static sync(listed: readonly DirectoryDc[]): void {
        const now = new Date().toISOString();
        const known = new Map(DomainControllerRepository.findAll().map((row) => [row.id.toLowerCase(), row]));
        let changed = false;

        for (const dc of listed) {
            const entry = { id: dc.id.toLowerCase(), name: dc.name, dnsHostName: dc.dnsHostName ?? null, site: dc.site ?? null };
            if (known.delete(entry.id)) {
                changed = DomainControllerRepository.updateListed(entry, now) || changed;
                continue;
            }
            DomainControllerRepository.insert(entry, now);
            changed = true;
            logger.info({ dc: entry.name, id: entry.id }, "A domain controller the directory lists is new here");
            ActivityService.record({
                kind: "dc.discovered",
                level: "info",
                dcId: entry.id,
                subject: { name: entry.name },
                data: { dcName: entry.name, dnsHostName: entry.dnsHostName, site: entry.site },
            });
        }

        for (const gone of known.values()) {
            DomainControllerRepository.delete(gone.id);
            DcConnections.forget(gone.id);
            changed = true;
            logger.info({ dc: gone.name, id: gone.id }, "The directory no longer lists a domain controller");
            ActivityService.record({
                kind: "dc.removed",
                level: "warning",
                dcId: gone.id,
                subject: { name: gone.name },
                data: { dcName: gone.name, dnsHostName: gone.dns_host_name, site: gone.site },
            });
        }

        if (changed) this.changed();
    }

    /** Sets where a domain controller is reached, or goes back to its name in the directory with null. */
    static setAddress(id: string, address: string | null): DomainController | null {
        if (DomainControllerRepository.updateAddress(id, address, new Date().toISOString()).changes === 0) return null;
        this.changed();
        return this.get(id);
    }

    /**
     * Issues the token a domain controller reports its database check with, in place of any
     * it had. Returned once: only its hash is kept.
     */
    static issueReportToken(id: string): CreatedReportToken | null {
        const token = crypto.randomBytes(32).toString("base64url");
        const dbcheckSince = new Date().toISOString();
        if (DomainControllerRepository.setReportToken(id, sha256(token), dbcheckSince).changes === 0) return null;
        this.changed();
        return { token, dbcheckSince };
    }

    /** Takes the token away: no database check is expected of this domain controller any more, and its last one is forgotten. */
    static revokeReportToken(id: string): boolean {
        if (DomainControllerRepository.setReportToken(id, null, null).changes === 0) return false;
        DcHealthService.clearDbcheck(id);
        this.changed();
        return true;
    }

    /** The domain controller a report token belongs to, or null for a token nobody was given. */
    static byReportToken(token: string): DomainController | null {
        // Looked up by the hash, so the comparison is the database's over a digest: nothing
        // about the stored value can be learned from how long a wrong token takes.
        const row = DomainControllerRepository.findByReportTokenHash(sha256(token));
        return row ? toView(row) : null;
    }
}
