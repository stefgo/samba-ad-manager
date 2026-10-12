/**
 * Which of Samba's services should run on a domain controller, and which of them do not.
 *
 * smb.conf names the services the `samba` process starts (`server services`); each one that
 * runs registers with Samba's internal messaging under a name of its own, which is what
 * `samba-tool processes` lists. The two vocabularies differ, and this is the one place that
 * ties them together.
 *
 * Only the services listed here are judged. One this build does not know -- a name a newer
 * Samba introduced -- is never reported as missing: silence about it is better than a
 * finding nobody can act on. Two that smb.conf names are left out on purpose: `wrepl` and
 * `ntp_signd` run and register nothing, as the development domain shows, and `s3fs` is the
 * file server, which registers as a process of its own kind.
 */
const MESSAGING_NAMES: Readonly<Record<string, string>> = {
    kdc: "kdc_server",
    ldap: "ldap_server",
    cldap: "cldap_server",
    drepl: "dreplsrv",
    kcc: "kccsrv",
    dnsupdate: "dnsupdate",
    dns: "dnssrv",
    rpc: "rpc_server",
    nbt: "nbt_server",
    winbindd: "winbind_server",
};

/** What a service does, for the reader of a finding who knows `drepl` only as a word in smb.conf. */
const SERVICE_LABELS: Readonly<Record<string, string>> = {
    kdc: "Kerberos (kdc)",
    ldap: "LDAP (ldap)",
    cldap: "CLDAP (cldap)",
    drepl: "replication (drepl)",
    kcc: "replication topology (kcc)",
    dnsupdate: "DNS registration (dnsupdate)",
    dns: "DNS (dns)",
    rpc: "RPC (rpc)",
    nbt: "NetBIOS name (nbt)",
    winbindd: "winbind (winbindd)",
};

export interface SambaServices {
    configured: readonly string[];
    running: readonly { name: string; pids: readonly number[] }[];
}

/** The configured services that are not running, as smb.conf names them. */
export function missingSambaServices(services: SambaServices): string[] {
    const running = new Set(services.running.filter((service) => service.pids.length > 0).map((service) => service.name));
    return services.configured.filter((name) => {
        const registered = MESSAGING_NAMES[name];
        return registered !== undefined && !running.has(registered);
    });
}

/** `replication (drepl)` for `drepl`; the name itself for one without a label. */
export const sambaServiceLabel = (name: string): string => SERVICE_LABELS[name] ?? name;
