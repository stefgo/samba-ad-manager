import type { PeerCertificate } from "node:tls";
import { describe, expect, it } from "vitest";
import { serverIdentityCheck } from "./serverIdentity.js";

/** What Node's name check reads of a certificate. */
const certificate = (commonName: string, ...names: string[]) =>
    ({
        subject: { CN: commonName },
        subjectaltname: names.map((name) => `DNS:${name}`).join(", "),
    }) as unknown as PeerCertificate;

const central = certificate("ldap.example.net", "ldap.example.net", "ldaps.example.org");

describe("serverIdentityCheck", () => {
    it("accepts a certificate for the domain controller's own name, as Node does", () => {
        const check = serverIdentityCheck([]);
        expect(check("dc1.home.lan", certificate("dc1.home.lan", "dc1.home.lan"))).toBeUndefined();
    });

    it("refuses a certificate for another name when no central name is configured", () => {
        expect(serverIdentityCheck([])("dc1.home.lan", central)).toBeInstanceOf(Error);
    });

    it("accepts a certificate for a central name in place of the domain controller's", () => {
        expect(serverIdentityCheck(["ldap.example.net"])("dc1.home.lan", central)).toBeUndefined();
        expect(serverIdentityCheck(["ldaps.example.org"])("dc1.home.lan", central)).toBeUndefined();
    });

    it("still refuses a certificate that carries neither", () => {
        const error = serverIdentityCheck(["ldap.example.net"])("dc1.home.lan", certificate("other.example.com", "other.example.com"));
        expect(error?.message).toContain("dc1.home.lan");
    });

    it("matches a wildcard as Node does, one label deep", () => {
        const wildcard = certificate("*.example.net", "*.example.net");
        expect(serverIdentityCheck(["ldap.example.net"])("dc1.home.lan", wildcard)).toBeUndefined();
        expect(serverIdentityCheck(["a.ldap.example.net"])("dc1.home.lan", wildcard)).toBeInstanceOf(Error);
    });
});
