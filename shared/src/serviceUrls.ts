/** A name applications reach the directory under, taken apart. */
export interface LdapServiceUrl {
    /** As written, trimmed: what it is told apart and shown by. */
    url: string;
    scheme: "ldap" | "ldaps";
    /** Lower case, an IPv6 address without its brackets. */
    host: string;
    port: number;
}

const SERVICE_URL = /^(ldaps?):\/\/(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?$/i;

/**
 * Takes apart an `ldap://host[:port]` or `ldaps://host[:port]` that names no domain
 * controller but the directory as a whole -- the name of a virtual address that moves between
 * them, say. Its domain has nothing to do with the realm's, and nothing here compares them.
 *
 * @returns null for anything else: another scheme, a path, credentials, a port out of range.
 */
export function parseLdapServiceUrl(value: string): LdapServiceUrl | null {
    const url = value.trim();
    const match = SERVICE_URL.exec(url);
    if (!match) return null;
    const scheme = match[1].toLowerCase() as LdapServiceUrl["scheme"];
    const port = match[3] ? Number(match[3]) : scheme === "ldaps" ? 636 : 389;
    if (port < 1 || port > 65535) return null;
    const host = match[2].replace(/^\[(.*)\]$/, "$1").toLowerCase();
    return { url, scheme, host, port };
}

/** The host names of the URLs, each once: the names a certificate may carry besides a domain controller's own. */
export function serviceUrlHosts(urls: readonly string[]): string[] {
    const hosts = urls.map((url) => parseLdapServiceUrl(url)?.host).filter((host): host is string => !!host);
    return [...new Set(hosts)];
}
