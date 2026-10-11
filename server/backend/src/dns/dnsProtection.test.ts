import { describe, expect, it } from "vitest";
import { dcHostNameSet, isDeletableRecord, isProtectedNode, isProtectedRecord } from "./dnsProtection.js";

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

describe("isDeletableRecord", () => {
    const dcs = { hostNames: dcHostNameSet(["dc1.sadm.test", "dc2.sadm.test"]), addresses: new Set(["172.28.0.21", "172.28.0.22"]) };
    const deletable = (zone: string, node: string, data: Parameters<typeof isDeletableRecord>[3]) =>
        isDeletableRecord(zone, node, node === "@" ? zone : `${node}.${zone}`, data, dcs);
    const srv = (target: string) => ({ type: "SRV" as const, priority: 0, weight: 100, port: 389, target });

    it("lets any record of an ordinary name go", () => {
        expect(deletable("sadm.test", "www", { type: "A", address: "192.0.2.10" })).toBe(true);
        expect(deletable("sadm.test", "www", { type: "TXT", strings: ["x"] })).toBe(true);
    });

    it("keeps what a domain controller registered for itself", () => {
        expect(deletable("sadm.test", "_ldap._tcp", srv("DC1.sadm.test."))).toBe(false);
        expect(deletable("_msdcs.sadm.test", "2b2b8064-861e-4d5a-b319-867e4f951265", { type: "CNAME", target: "dc2.sadm.test" })).toBe(false);
        expect(deletable("sadm.test", "@", { type: "A", address: "172.28.0.21" })).toBe(false);
    });

    it("lets go what names a domain controller that is none", () => {
        expect(deletable("sadm.test", "_ldap._tcp", srv("dc9.sadm.test"))).toBe(true);
        expect(deletable("_msdcs.sadm.test", "99999999-0000-4000-8000-000000000000", { type: "CNAME", target: "dc9.sadm.test" })).toBe(true);
        expect(deletable("sadm.test", "@", { type: "A", address: "172.28.0.99" })).toBe(true);
    });

    it("keeps the zone's own records, whoever they name", () => {
        expect(deletable("sadm.test", "@", { type: "NS", target: "ns2.sadm.test" })).toBe(false);
        expect(
            deletable("sadm.test", "@", { type: "SOA", serial: 1, refresh: 1, retry: 1, expire: 1, minimum: 1, primary: "x.test", mailbox: "y.test" }),
        ).toBe(false);
    });

    it("keeps the addresses under a domain controller's own name, whatever they are", () => {
        expect(deletable("sadm.test", "dc1", { type: "A", address: "10.9.9.9" })).toBe(false);
        expect(deletable("sadm.test", "dc1", { type: "TXT", strings: ["note"] })).toBe(true);
    });
});
