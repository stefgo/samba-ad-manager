import { directoryConfig, readDirectoryCa } from "../config/AppConfig.js";
import { DcLdap } from "./DcLdap.js";

/** What of a domain controller says where it is reached. */
export interface DcLocation {
    id: string;
    dnsHostName: string | null;
    /** Set by an operator where the name in the directory does not resolve from here. */
    address: string | null;
}

/** Where a domain controller is reached, or null when the directory names no host for it and none was set. */
export const dcHost = (dc: DcLocation): string | null => dc.address || dc.dnsHostName || null;

/**
 * The connections to the directory, one per domain controller, opened on demand and kept.
 *
 * All of them bind as the one account of `directory.bindDn` and check certificates against
 * the one CA file: the domain has one administrator's worth of trust in this server, not
 * one per domain controller.
 */
export class DcConnections {
    private static bound = new Map<string, { key: string; ldap: DcLdap }>();
    private static seeds = new Map<string, DcLdap>();
    private static ca: { read: boolean; value: Buffer | undefined } = { read: false, value: undefined };

    /** Whether this server has been given an account in the directory. */
    static canBind(): boolean {
        return !!directoryConfig.bindDn && !!directoryConfig.password;
    }

    /** Whether it has been told where the directory is, and as whom to ask. */
    static isConfigured(): boolean {
        return directoryConfig.urls.length > 0 && this.canBind();
    }

    private static caFile(): Buffer | undefined {
        // Read once: a file that is missing fails every connection the same way, and says so there.
        if (!this.ca.read) this.ca = { read: true, value: readDirectoryCa() };
        return this.ca.value;
    }

    private static open(url: string, servername: string | null, bind: boolean): DcLdap {
        return new DcLdap({
            url,
            servername,
            bind: bind && this.canBind() ? { dn: directoryConfig.bindDn!, password: directoryConfig.password! } : null,
            ca: this.caFile(),
            allowSelfSigned: directoryConfig.allowSelfSigned,
            timeoutMs: directoryConfig.timeoutMs,
        });
    }

    /** The certificate name to check when the host connected to is an address set by hand. */
    private static servername(dc: DcLocation): string | null {
        return dc.address && dc.dnsHostName && dc.address !== dc.dnsHostName ? dc.dnsHostName : null;
    }

    /** The kept, bound connection to a domain controller. Throws when it has no host. */
    static for(dc: DcLocation): DcLdap {
        const host = dcHost(dc);
        if (!host) throw new Error("The directory names no host for this domain controller, and no address is set");
        const key = `${host}|${dc.dnsHostName ?? ""}`;
        const existing = this.bound.get(dc.id);
        if (existing?.key === key) return existing.ldap;
        // Its address changed: the old connection goes to a host it is no longer reached at.
        void existing?.ldap.reset();
        const ldap = this.open(`ldaps://${hostInUrl(host)}`, this.servername(dc), true);
        this.bound.set(dc.id, { key, ldap });
        return ldap;
    }

    /**
     * A connection of its own, not bound and not kept: for asking a domain controller what
     * it tells anyone, which is also the test whether its directory answers at all. The
     * caller closes it (`reset`).
     */
    static anonymous(dc: DcLocation): DcLdap {
        const host = dcHost(dc);
        if (!host) throw new Error("The directory names no host for this domain controller, and no address is set");
        return this.open(`ldaps://${hostInUrl(host)}`, this.servername(dc), false);
    }

    /** The kept, bound connection to one of `directory.urls`: where the domain is first asked who its domain controllers are. */
    static seed(url: string): DcLdap {
        let ldap = this.seeds.get(url);
        if (!ldap) {
            ldap = this.open(url, null, true);
            this.seeds.set(url, ldap);
        }
        return ldap;
    }

    /** Closes and forgets the connection to a domain controller that is gone. */
    static forget(dcId: string): void {
        void this.bound.get(dcId)?.ldap.reset();
        this.bound.delete(dcId);
    }
}

/** A host as a URL wants it: an IPv6 address in brackets. */
function hostInUrl(host: string): string {
    return host.includes(":") ? `[${host}]` : host;
}
