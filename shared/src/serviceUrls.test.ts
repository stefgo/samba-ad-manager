import { describe, expect, it } from "vitest";
import { parseLdapServiceUrl, serviceUrlHosts } from "./serviceUrls.js";

describe("parseLdapServiceUrl", () => {
    it("gives each scheme its own default port", () => {
        expect(parseLdapServiceUrl("ldap://ldap.example.net")).toEqual({
            url: "ldap://ldap.example.net",
            scheme: "ldap",
            host: "ldap.example.net",
            port: 389,
        });
        expect(parseLdapServiceUrl("ldaps://ldap.example.net")?.port).toBe(636);
    });

    it("keeps a port that is given", () => {
        expect(parseLdapServiceUrl("ldaps://ldap.example.net:1636")?.port).toBe(1636);
    });

    it("reads the scheme and the host in any case, and keeps the URL as written", () => {
        expect(parseLdapServiceUrl(" LDAPS://LDAP.Example.NET ")).toEqual({
            url: "LDAPS://LDAP.Example.NET",
            scheme: "ldaps",
            host: "ldap.example.net",
            port: 636,
        });
    });

    it("takes an IPv6 address without its brackets", () => {
        expect(parseLdapServiceUrl("ldaps://[2001:db8::10]:636")?.host).toBe("2001:db8::10");
    });

    it("refuses what is not a bare ldap:// or ldaps:// URL", () => {
        for (const value of [
            "ldap.example.net",
            "https://ldap.example.net",
            "ldaps://ldap.example.net/",
            "ldaps://ldap.example.net/dc=example",
            "ldaps://user@ldap.example.net",
            "ldaps://ldap.example.net:0",
            "ldaps://ldap.example.net:65536",
            "ldaps://",
        ]) {
            expect(parseLdapServiceUrl(value), value).toBeNull();
        }
    });
});

describe("serviceUrlHosts", () => {
    it("names a host shared by an ldap:// and an ldaps:// URL once", () => {
        expect(serviceUrlHosts(["ldap://ldap.example.net", "ldaps://LDAP.example.net", "ldaps://ldaps.example.org"])).toEqual([
            "ldap.example.net",
            "ldaps.example.org",
        ]);
    });

    it("leaves out what does not parse", () => {
        expect(serviceUrlHosts(["https://ldap.example.net"])).toEqual([]);
    });
});
