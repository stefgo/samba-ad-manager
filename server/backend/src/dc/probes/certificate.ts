import type { PeerCertificate } from "node:tls";
import type { TlsCertificate } from "@sadm/shared";

const first = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

/** A date as Node writes it into a certificate (`Oct 17 00:00:00 2026 GMT`), as ISO time where it can be read. */
const isoDate = (value: string): string => {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
};

/** What of a certificate a measurement keeps. */
export function certificateOf(peer: PeerCertificate): TlsCertificate {
    const names = (peer.subjectaltname ?? "")
        .split(",")
        .map((entry) => entry.trim().replace(/^(DNS|IP Address):/, ""))
        .filter((entry) => entry !== "");
    return {
        subject: first(peer.subject?.CN),
        issuer: first(peer.issuer?.CN) ?? first(peer.issuer?.O),
        names,
        validFrom: isoDate(peer.valid_from),
        validTo: isoDate(peer.valid_to),
    };
}

/**
 * Why a certificate is not good for a host, as an operator reads it. `code` is what Node
 * gives as the reason: an OpenSSL code for the chain, its own for the name.
 */
export function untrustedReason(code: string, certificate: TlsCertificate | null): string {
    switch (code) {
        case "ERR_TLS_CERT_ALTNAME_INVALID":
            return certificate && certificate.names.length > 0
                ? `it is issued for ${certificate.names.join(", ")}`
                : "it is issued for another name";
        case "CERT_HAS_EXPIRED":
            return "it has expired";
        case "CERT_NOT_YET_VALID":
            return "it is not valid yet";
        case "DEPTH_ZERO_SELF_SIGNED_CERT":
            return "it is self-signed";
        case "SELF_SIGNED_CERT_IN_CHAIN":
        case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
        case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
            return `its issuer${certificate?.issuer ? ` ${certificate.issuer}` : ""} is not trusted here`;
        default:
            return code;
    }
}
