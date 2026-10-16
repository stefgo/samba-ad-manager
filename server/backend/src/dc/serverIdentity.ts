import { checkServerIdentity, type PeerCertificate } from "node:tls";

/**
 * The check of the name in a domain controller's certificate, extended by the host names of
 * `directory.serviceUrls`.
 *
 * Samba has one certificate and presents it under every name it is reached by. One issued
 * for the name applications use -- by Let's Encrypt, which cannot issue for a private realm --
 * does not carry the domain controller's own name, and would fail Node's check every time.
 * Only the name is widened: the chain is still checked in full, before this is called.
 *
 * @returns undefined when the certificate is good for the host or for one of `alsoAccepted`;
 *   the error for the host otherwise.
 */
export function serverIdentityCheck(alsoAccepted: readonly string[]) {
    return (host: string, cert: PeerCertificate): Error | undefined => {
        const own = checkServerIdentity(host, cert);
        if (!own) return undefined;
        return alsoAccepted.some((name) => checkServerIdentity(name, cert) === undefined) ? undefined : own;
    };
}
