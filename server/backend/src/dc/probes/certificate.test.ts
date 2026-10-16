import type { PeerCertificate } from "node:tls";
import { describe, expect, it } from "vitest";
import { certificateOf, untrustedReason } from "./certificate.js";

const peer = (over: Record<string, unknown> = {}) =>
    ({
        subject: { CN: "ldap.example.net" },
        issuer: { C: "US", O: "Let's Encrypt", CN: "R10" },
        subjectaltname: "DNS:ldap.example.net, DNS:ldaps.example.org, IP Address:192.0.2.10",
        valid_from: "Aug 18 00:00:00 2026 GMT",
        valid_to: "Nov 16 23:59:59 2026 GMT",
        ...over,
    }) as unknown as PeerCertificate;

describe("certificateOf", () => {
    it("keeps the names, the issuer and the dates, as ISO time", () => {
        expect(certificateOf(peer())).toEqual({
            subject: "ldap.example.net",
            issuer: "R10",
            names: ["ldap.example.net", "ldaps.example.org", "192.0.2.10"],
            validFrom: "2026-08-18T00:00:00.000Z",
            validTo: "2026-11-16T23:59:59.000Z",
        });
    });

    it("names the issuer by its organization where it has no common name", () => {
        expect(certificateOf(peer({ issuer: { O: "Samba Administration" } })).issuer).toBe("Samba Administration");
    });

    it("does without alternative names", () => {
        expect(certificateOf(peer({ subjectaltname: undefined })).names).toEqual([]);
    });
});

describe("untrustedReason", () => {
    const certificate = certificateOf(peer());

    it("names what a certificate is issued for when the host is not among it", () => {
        expect(untrustedReason("ERR_TLS_CERT_ALTNAME_INVALID", certificate)).toBe(
            "it is issued for ldap.example.net, ldaps.example.org, 192.0.2.10",
        );
    });

    it("reads the chain's reasons", () => {
        expect(untrustedReason("CERT_HAS_EXPIRED", certificate)).toBe("it has expired");
        expect(untrustedReason("DEPTH_ZERO_SELF_SIGNED_CERT", certificate)).toBe("it is self-signed");
        expect(untrustedReason("UNABLE_TO_VERIFY_LEAF_SIGNATURE", certificate)).toBe("its issuer R10 is not trusted here");
    });

    it("passes on a code it does not know", () => {
        expect(untrustedReason("CERT_REVOKED", null)).toBe("CERT_REVOKED");
    });
});
