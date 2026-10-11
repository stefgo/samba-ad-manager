import type { ActivityKind, DirectoryChanged } from "@sadm/shared";
import { directoryConfig } from "../config/AppConfig.js";
import { DcConnections } from "../dc/DcConnections.js";
import { ldapCode } from "../dc/DcLdap.js";
import { DirectoryError } from "../directory/DirectoryError.js";
import { DirectoryOperations } from "../directory/DirectoryOperations.js";
import { DnsOperations, type DnsChanged } from "../dns/DnsOperations.js";
import { DomainControllerRepository, type DomainControllerRow } from "../repositories/DomainControllerRepository.js";
import { ActivityService } from "./ActivityService.js";
import { DcHealthService } from "./DcHealthService.js";

/** Who asked for a change, for the record of it. */
export interface Actor {
    username: string;
}

/** Why the directory cannot be used right now; null when it can. */
export type DirectoryUnavailable = "not-configured" | "disabled" | "unreachable";

export interface DirectoryStatus {
    available: boolean;
    writable: boolean;
    /** The domain controller questions and changes go to. */
    via: { dcId: string; name: string } | null;
    reason: DirectoryUnavailable | null;
}

/**
 * The directory, read and changed on whichever domain controller is best placed to answer.
 *
 * Every domain controller holds the whole directory, so any that answers can be read and --
 * replication carries a change to the others -- written. The PDC emulator is asked first:
 * it is where password changes are authoritative and where other tools write by default, so
 * what is read there is what was last written. Without it, any other will do.
 *
 * Whether the directory may be used at all, and changed, is `directory.enabled` and
 * `directory.readOnly` in config.yaml: decided where an operator set this server up, not
 * anywhere a login of this application reaches.
 */
export class DirectoryService {
    private static operations = new Map<string, { key: string; operations: DirectoryOperations; dns: DnsOperations }>();

    /** Whether a domain controller's directory answered when it was last measured. */
    private static answers(row: DomainControllerRow): boolean {
        return DcHealthService.get(row.id)?.services.some((service) => service.port === 636 && service.ok) ?? false;
    }

    /** The domain controllers that can be asked, the PDC emulator first, then by name. */
    private static candidates(): DomainControllerRow[] {
        const rows = DomainControllerRepository.findAll().filter((row) => this.answers(row));
        const isPdc = (row: DomainControllerRow) =>
            DcHealthService.get(row.id)?.domain?.fsmo?.pdc?.toUpperCase() === row.name.toUpperCase();
        return [...rows].sort((a, b) => Number(isPdc(b)) - Number(isPdc(a)) || a.name.localeCompare(b.name));
    }

    private static unavailable(): DirectoryUnavailable | null {
        if (!DcConnections.isConfigured()) return "not-configured";
        if (!directoryConfig.enabled) return "disabled";
        return this.candidates().length === 0 ? "unreachable" : null;
    }

    /** What the dashboard needs to know before it offers anything: can the directory be read, and changed, and where. */
    static status(): DirectoryStatus {
        const reason = this.unavailable();
        if (reason) return { available: false, writable: false, via: null, reason };
        const [dc] = this.candidates();
        return { available: true, writable: !directoryConfig.readOnly, via: { dcId: dc.id, name: dc.name }, reason: null };
    }

    /** The domain controller to ask, with the operations on its directory. A refusal when there is none. */
    private static pick(): { dc: DomainControllerRow; operations: DirectoryOperations; dns: DnsOperations } {
        switch (this.unavailable()) {
            case "not-configured":
                throw new DirectoryError("unavailable", "The directory is not configured on this server");
            case "disabled":
                throw new DirectoryError("forbidden", "The directory is switched off on this server (directory.enabled is false)");
            case "unreachable":
                throw new DirectoryError("unavailable", "No domain controller's directory answers");
        }
        const [dc] = this.candidates();
        const location = { id: dc.id, dnsHostName: dc.dns_host_name, address: dc.address };
        const ldap = DcConnections.for(location);
        // A connection that was replaced -- its address changed -- takes its operations with it.
        const key = ldap.url;
        let entry = this.operations.get(dc.id);
        if (entry?.key !== key) {
            entry = {
                key,
                operations: new DirectoryOperations(ldap, { bindDn: directoryConfig.bindDn!, readOnly: directoryConfig.readOnly }),
                dns: new DnsOperations(ldap, { readOnly: directoryConfig.readOnly }),
            };
            this.operations.set(dc.id, entry);
        }
        return { dc, operations: entry.operations, dns: entry.dns };
    }

    /** What went wrong on the way to the directory, as a refusal: it is not there, rather than it said no. */
    private static refusal(err: unknown): unknown {
        if (err instanceof DirectoryError || ldapCode(err) !== null) return err;
        const detail = err instanceof Error ? err.message : String(err);
        return new DirectoryError("unavailable", `The directory could not be reached: ${detail}`);
    }

    /** A question about the directory. */
    static async read<T>(work: (directory: DirectoryOperations) => Promise<T>): Promise<T> {
        const { operations } = this.pick();
        try {
            return await work(operations);
        } catch (err) {
            throw this.refusal(err);
        }
    }

    /** A question about the DNS zones, which are in the directory and asked on the same domain controller. */
    static async readDns<T>(work: (dns: DnsOperations) => Promise<T>): Promise<T> {
        const { dns } = this.pick();
        try {
            return await work(dns);
        } catch (err) {
            throw this.refusal(err);
        }
    }

    /**
     * A change to the directory, recorded once it is made: who made it, to which object, on
     * which domain controller. A change the directory refuses leaves no record -- it did
     * not happen.
     */
    static async change<T extends DirectoryChanged>(
        actor: Actor,
        kind: ActivityKind,
        work: (directory: DirectoryOperations) => Promise<T>,
        facts: Record<string, unknown> = {},
    ): Promise<T> {
        if (directoryConfig.readOnly) {
            throw new DirectoryError("forbidden", "The directory is read-only on this server (directory.readOnly is true)");
        }
        const { dc, operations } = this.pick();
        let changed: T;
        try {
            changed = await work(operations);
        } catch (err) {
            throw this.refusal(err);
        }
        this.record(actor, kind, dc, changed, facts);
        return changed;
    }

    /**
     * A change to a DNS record, recorded the same way: the record is the object, named by
     * the name it is under, and the activity says what it says -- and said before.
     */
    static async changeDns(actor: Actor, kind: ActivityKind, work: (dns: DnsOperations) => Promise<DnsChanged>): Promise<DnsChanged> {
        if (directoryConfig.readOnly) {
            throw new DirectoryError("forbidden", "The directory is read-only on this server (directory.readOnly is true)");
        }
        const { dc, dns } = this.pick();
        let changed: DnsChanged;
        try {
            changed = await work(dns);
        } catch (err) {
            throw this.refusal(err);
        }
        const { zone, record, was } = changed;
        if (!changed.unchanged) this.record(actor, kind, dc, changed, { zone, record, ...(was ? { was } : {}) });
        return changed;
    }

    private static record(actor: Actor, kind: ActivityKind, dc: DomainControllerRow, changed: DirectoryChanged, facts: Record<string, unknown>): void {
        ActivityService.record({
            kind,
            level: "info",
            dcId: dc.id,
            subject: { dn: changed.dn, name: changed.name },
            data: { actor: actor.username, name: changed.name, type: changed.type, dcName: dc.name, ...facts },
        });
    }
}
