import { describe, expect, it } from "vitest";
import { dcHostNameSet, isProtectedNode, isProtectedRecord } from "./dnsProtection.js";

describe("isProtectedNode", () => {
    it("protects the zone itself", () => {
        expect(isProtectedNode("sadm.test", "@")).toBe(true);
    });

    it("protects every name a service is found under, however deep", () => {
        expect(isProtectedNode("sadm.test", "_ldap._tcp")).toBe(true);
        expect(isProtectedNode("sadm.test", "_ldap._tcp.Default-First-Site-Name._sites")).toBe(true);
        expect(isProtectedNode("sadm.test", "_kerberos._udp")).toBe(true);
        // A domain whose `_msdcs` is not a zone of its own keeps it as names of the domain's zone.
        expect(isProtectedNode("sadm.test", "gc._msdcs")).toBe(true);
    });

    it("protects everything in the zone the domain controllers are found in", () => {
        expect(isProtectedNode("_msdcs.sadm.test", "gc")).toBe(true);
        expect(isProtectedNode("_MSDCS.sadm.test", "2b2b8064-861e-4d5a-b319-867e4f951265")).toBe(true);
    });

    it("protects the names of the DNS partitions, and what is below them", () => {
        expect(isProtectedNode("sadm.test", "DomainDnsZones")).toBe(true);
        expect(isProtectedNode("sadm.test", "ForestDnsZones")).toBe(true);
        expect(isProtectedNode("sadm.test", "_ldap._tcp.DomainDnsZones")).toBe(true);
    });

    it("leaves an ordinary name alone, a domain controller's included", () => {
        expect(isProtectedNode("sadm.test", "www")).toBe(false);
        expect(isProtectedNode("sadm.test", "dc1")).toBe(false);
        expect(isProtectedNode("sadm.test", "a.b.c")).toBe(false);
        expect(isProtectedNode("2.0.192.in-addr.arpa", "10")).toBe(false);
        // An underscore that is not at the start of a label makes no service name.
        expect(isProtectedNode("sadm.test", "my_host")).toBe(false);
    });
});

describe("isProtectedRecord", () => {
    const dcs = dcHostNameSet(["DC1.sadm.test", "dc2.sadm.test.", null]);

    it("protects the addresses under a domain controller's name", () => {
        expect(isProtectedRecord("dc1.sadm.test", { type: "A" }, dcs)).toBe(true);
        expect(isProtectedRecord("DC2.SADM.TEST", { type: "AAAA" }, dcs)).toBe(true);
    });

    it("leaves anything else under that name to the operator", () => {
        expect(isProtectedRecord("dc1.sadm.test", { type: "TXT" }, dcs)).toBe(false);
    });

    it("leaves the addresses of any other name alone", () => {
        expect(isProtectedRecord("www.sadm.test", { type: "A" }, dcs)).toBe(false);
    });
});
