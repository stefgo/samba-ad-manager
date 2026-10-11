import { describe, expect, it } from "vitest";
import {
    describeExpectedRecord,
    expectedDcRecords,
    locateInZones,
    missingDcRecords,
    staleDcRecords,
    type DcRecordFacts,
    type ExpectedDcRecord,
} from "./dcDnsRecords.js";
import type { DnsRecordData } from "./dns.js";

const DOMAIN = { domain: "sadm.test", forest: "sadm.test", domainGuid: "c9030b41-c68d-4a4f-bee6-5d23a65f32aa" };

const DC1: DcRecordFacts = {
    hostName: "dc1.sadm.test",
    ntdsGuid: "d7595c3f-81e6-41bd-920a-7a3643407f79",
    site: "Default-First-Site-Name",
    isGlobalCatalog: true,
    isPdc: true,
    isReadOnly: false,
    holdsDomainDns: true,
    holdsForestDns: true,
};
const DC2: DcRecordFacts = { ...DC1, hostName: "DC2.sadm.test", ntdsGuid: "2B2B8064-861E-4D5A-B319-867E4F951265", isPdc: false };

/** What a list of expected records reads as: one line each, the way the lists below are written. */
const lines = (records: ExpectedDcRecord[]) =>
    records.map((record) => `${record.kind} ${record.name}${record.port ? ` ${record.port}` : ""}`).sort();

// What `samba_dnsupdate --verbose --all-names` registered on dc1 of the development domain
// (Samba 4.22): the PDC emulator, a global catalog and a DNS server.
const DC1_REGISTERS = [
    "host dc1.sadm.test",
    "address domaindnszones.sadm.test",
    "address forestdnszones.sadm.test",
    "address gc._msdcs.sadm.test",
    "address sadm.test",
    "cname d7595c3f-81e6-41bd-920a-7a3643407f79._msdcs.sadm.test",
    "ns _msdcs.sadm.test",
    "ns sadm.test",
    "srv _gc._tcp.default-first-site-name._sites.sadm.test 3268",
    "srv _gc._tcp.sadm.test 3268",
    "srv _kerberos._tcp.dc._msdcs.sadm.test 88",
    "srv _kerberos._tcp.default-first-site-name._sites.dc._msdcs.sadm.test 88",
    "srv _kerberos._tcp.default-first-site-name._sites.sadm.test 88",
    "srv _kerberos._tcp.sadm.test 88",
    "srv _kerberos._udp.sadm.test 88",
    "srv _kpasswd._tcp.sadm.test 464",
    "srv _kpasswd._udp.sadm.test 464",
    "srv _ldap._tcp.c9030b41-c68d-4a4f-bee6-5d23a65f32aa.domains._msdcs.sadm.test 389",
    "srv _ldap._tcp.dc._msdcs.sadm.test 389",
    "srv _ldap._tcp.default-first-site-name._sites.dc._msdcs.sadm.test 389",
    "srv _ldap._tcp.default-first-site-name._sites.domaindnszones.sadm.test 389",
    "srv _ldap._tcp.default-first-site-name._sites.forestdnszones.sadm.test 389",
    "srv _ldap._tcp.default-first-site-name._sites.gc._msdcs.sadm.test 3268",
    "srv _ldap._tcp.default-first-site-name._sites.sadm.test 389",
    "srv _ldap._tcp.domaindnszones.sadm.test 389",
    "srv _ldap._tcp.forestdnszones.sadm.test 389",
    "srv _ldap._tcp.gc._msdcs.sadm.test 3268",
    "srv _ldap._tcp.pdc._msdcs.sadm.test 389",
    "srv _ldap._tcp.sadm.test 389",
].sort();

describe("expectedDcRecords", () => {
    it("lists what Samba registers for the PDC emulator of a forest of one domain", () => {
        expect(lines(expectedDcRecords(DC1, DOMAIN))).toEqual(DC1_REGISTERS);
    });

    it("lists the same for another domain controller, without the PDC's record", () => {
        const expected = lines(expectedDcRecords(DC2, DOMAIN));
        expect(expected).toHaveLength(28);
        expect(expected).toContain("host dc2.sadm.test");
        expect(expected).toContain("cname 2b2b8064-861e-4d5a-b319-867e4f951265._msdcs.sadm.test");
        expect(expected.join("\n")).not.toContain("pdc._msdcs");
    });

    it("leaves out what only a global catalog and only a DNS server register", () => {
        const plain = lines(expectedDcRecords({ ...DC2, isGlobalCatalog: false, holdsDomainDns: false, holdsForestDns: false }, DOMAIN));
        expect(plain.join("\n")).not.toMatch(/gc\.|_gc\.|dnszones|^ns /m);
        expect(plain).toContain("srv _ldap._tcp.dc._msdcs.sadm.test 389");
        expect(plain).toHaveLength(15);
    });

    it("expects of a read-only domain controller only what one registers", () => {
        expect(lines(expectedDcRecords({ ...DC2, isReadOnly: true }, DOMAIN))).toEqual(
            [
                "host dc2.sadm.test",
                "cname 2b2b8064-861e-4d5a-b319-867e4f951265._msdcs.sadm.test",
                "srv _ldap._tcp.default-first-site-name._sites.sadm.test 389",
                "srv _ldap._tcp.default-first-site-name._sites.dc._msdcs.sadm.test 389",
                "srv _kerberos._tcp.default-first-site-name._sites.sadm.test 88",
                "srv _kerberos._tcp.default-first-site-name._sites.dc._msdcs.sadm.test 88",
                "srv _gc._tcp.default-first-site-name._sites.sadm.test 3268",
                "srv _ldap._tcp.default-first-site-name._sites.gc._msdcs.sadm.test 3268",
                "srv _ldap._tcp.default-first-site-name._sites.domaindnszones.sadm.test 389",
                "srv _ldap._tcp.default-first-site-name._sites.forestdnszones.sadm.test 389",
            ].sort(),
        );
    });

    it("puts what belongs to the forest under the forest's name in a child domain", () => {
        const child = lines(expectedDcRecords(DC1, { domain: "eu.sadm.test", forest: "sadm.test", domainGuid: null }));
        expect(child).toContain("cname d7595c3f-81e6-41bd-920a-7a3643407f79._msdcs.sadm.test");
        expect(child).toContain("srv _ldap._tcp.dc._msdcs.eu.sadm.test 389");
        expect(child).toContain("srv _gc._tcp.sadm.test 3268");
        expect(child).toContain("ns eu.sadm.test");
        expect(child).toContain("ns sadm.test");
        // Without the domain's GUID the record under it is not asked for.
        expect(child.join("\n")).not.toContain(".domains._msdcs");
    });

    it("marks what a domain controller is not found without", () => {
        const essential = expectedDcRecords(DC1, DOMAIN).filter((record) => record.essential);
        expect(lines(essential)).toEqual(
            [
                "host dc1.sadm.test",
                "cname d7595c3f-81e6-41bd-920a-7a3643407f79._msdcs.sadm.test",
                "srv _ldap._tcp.dc._msdcs.sadm.test 389",
                "srv _kerberos._tcp.dc._msdcs.sadm.test 88",
            ].sort(),
        );
    });
});

/** A zone as a map from name to records, and the lookup the functions take. */
function zone(entries: Record<string, DnsRecordData[]>) {
    const map = new Map(Object.entries(entries).map(([name, records]) => [name.toLowerCase(), records]));
    return (name: string) => map.get(name.toLowerCase()) ?? [];
}

const a = (address: string): DnsRecordData => ({ type: "A", address });
const srv = (target: string, port: number): DnsRecordData => ({ type: "SRV", priority: 0, weight: 100, port, target });
const cname = (target: string): DnsRecordData => ({ type: "CNAME", target });

/** Everything both domain controllers of the development domain have registered. */
function registered(...dcs: (DcRecordFacts & { address: string })[]): Record<string, DnsRecordData[]> {
    const entries: Record<string, DnsRecordData[]> = {};
    const put = (name: string, data: DnsRecordData) => (entries[name] = [...(entries[name] ?? []), data]);
    for (const dc of dcs) {
        for (const record of expectedDcRecords(dc, DOMAIN)) {
            if (record.kind === "host" || record.kind === "address") put(record.name, a(dc.address));
            else if (record.kind === "cname") put(record.name, cname(`${dc.hostName}.`));
            else if (record.kind === "ns") put(record.name, { type: "NS", target: dc.hostName });
            else put(record.name, srv(dc.hostName.toUpperCase(), record.port!));
        }
    }
    return entries;
}

const BOTH = registered({ ...DC1, address: "172.28.0.21" }, { ...DC2, address: "172.28.0.22" });
const missing = (dc: DcRecordFacts, entries: Record<string, DnsRecordData[]>) =>
    lines(missingDcRecords(expectedDcRecords(dc, DOMAIN), dc.hostName, zone(entries)));

describe("missingDcRecords", () => {
    it("misses nothing in a domain where every record is there, however it is spelled", () => {
        expect(missing(DC1, BOTH)).toEqual([]);
        expect(missing(DC2, BOTH)).toEqual([]);
    });

    it("misses the alias a replication partner finds the domain controller by", () => {
        const without = { ...BOTH, "2b2b8064-861e-4d5a-b319-867e4f951265._msdcs.sadm.test": [] };
        expect(missing(DC2, without)).toEqual(["cname 2b2b8064-861e-4d5a-b319-867e4f951265._msdcs.sadm.test"]);
        expect(missing(DC1, without)).toEqual([]);
    });

    it("misses a service record that names only the other domain controller", () => {
        const name = "_kpasswd._tcp.sadm.test";
        expect(missing(DC2, { ...BOTH, [name]: [srv("dc1.sadm.test", 464)] })).toEqual(["srv _kpasswd._tcp.sadm.test 464"]);
    });

    it("misses a service record that names the domain controller on another port", () => {
        const name = "_ldap._tcp.sadm.test";
        expect(missing(DC1, { ...BOTH, [name]: [srv("dc1.sadm.test", 636), srv("dc2.sadm.test", 389)] })).toEqual([
            "srv _ldap._tcp.sadm.test 389",
        ]);
    });

    it("misses the domain controller's address where the domain lists only the other's", () => {
        expect(missing(DC2, { ...BOTH, "sadm.test": [a("172.28.0.21")] })).toEqual(["address sadm.test", "ns sadm.test"]);
    });

    it("expects every address of a domain controller with two under the shared names", () => {
        const twoAddresses = { ...BOTH, "dc1.sadm.test": [a("172.28.0.21"), { type: "AAAA" as const, address: "fd00::21" }] };
        expect(missing(DC1, twoAddresses)).toEqual([
            "address domaindnszones.sadm.test",
            "address forestdnszones.sadm.test",
            "address gc._msdcs.sadm.test",
            "address sadm.test",
        ]);
    });

    it("says of a domain controller without an address that it has none, and not four times over", () => {
        expect(missing(DC1, { ...BOTH, "dc1.sadm.test": [] })).toEqual(["host dc1.sadm.test"]);
    });
});

describe("staleDcRecords", () => {
    const names = (...dcs: DcRecordFacts[]) => {
        const kinds = new Map<string, Set<ExpectedDcRecord["kind"]>>();
        for (const dc of dcs) {
            for (const record of expectedDcRecords(dc, DOMAIN)) kinds.set(record.name, (kinds.get(record.name) ?? new Set()).add(record.kind));
        }
        return [...kinds].map(([name, of]) => ({ name, kinds: of }));
    };
    const hosts = [DC1.hostName, DC2.hostName];
    const stale = (entries: Record<string, DnsRecordData[]>) => staleDcRecords(names(DC1, DC2), hosts, zone(entries));

    it("finds nothing stale where every record names a domain controller", () => {
        expect(stale(BOTH)).toEqual([]);
    });

    it("finds a service record for a host that is no domain controller", () => {
        const name = "_ldap._tcp.dc._msdcs.sadm.test";
        expect(stale({ ...BOTH, [name]: [...BOTH[name], srv("DC9.sadm.test.", 389)] })).toEqual([
            { target: "dc9.sadm.test", type: "SRV", name },
        ]);
    });

    it("finds an address under the domain's name that is no domain controller's", () => {
        expect(stale({ ...BOTH, "sadm.test": [...BOTH["sadm.test"], a("172.28.0.99")] })).toEqual([
            { target: "172.28.0.99", type: "A", name: "sadm.test" },
        ]);
    });

    it("leaves a secondary alone that the zone lists as a name server", () => {
        expect(stale({ ...BOTH, "sadm.test": [...BOTH["sadm.test"], { type: "NS", target: "ns2.sadm.test" }] })).toEqual([]);
    });

    it("finds the alias of a domain controller that is gone, where it is asked to look under it", () => {
        const gone = "99999999-0000-4000-8000-000000000000._msdcs.sadm.test";
        const withAlias = [...names(DC1, DC2), { name: gone, kinds: new Set<ExpectedDcRecord["kind"]>(["cname"]) }];
        expect(staleDcRecords(withAlias, hosts, zone({ ...BOTH, [gone]: [cname("dc9.sadm.test")] }))).toEqual([
            { target: "dc9.sadm.test", type: "CNAME", name: gone },
        ]);
    });
});

describe("locateInZones", () => {
    const zones = ["sadm.test", "_msdcs.sadm.test", "2.0.192.in-addr.arpa"];

    it("finds a name in the longest zone it ends in", () => {
        expect(locateInZones("_ldap._tcp.dc._msdcs.sadm.test", zones)).toEqual({ zone: "_msdcs.sadm.test", node: "_ldap._tcp.dc" });
        expect(locateInZones("DC1.sadm.test.", zones)).toEqual({ zone: "sadm.test", node: "dc1" });
    });

    it("calls the zone itself `@`", () => {
        expect(locateInZones("sadm.test", zones)).toEqual({ zone: "sadm.test", node: "@" });
        expect(locateInZones("_msdcs.sadm.test", zones)).toEqual({ zone: "_msdcs.sadm.test", node: "@" });
    });

    it("keeps `_msdcs` in the domain's zone where it has no zone of its own", () => {
        expect(locateInZones("gc._msdcs.sadm.test", ["sadm.test"])).toEqual({ zone: "sadm.test", node: "gc._msdcs" });
    });

    it("finds no zone for a name that is in none, and none by a matching tail of letters", () => {
        expect(locateInZones("dc1.example.net", zones)).toBeNull();
        expect(locateInZones("notsadm.test", zones)).toBeNull();
    });
});

describe("describeExpectedRecord", () => {
    it("says what is missing the way a zone would write it", () => {
        expect(describeExpectedRecord({ kind: "srv", name: "_ldap._tcp.sadm.test", port: 389, essential: false })).toBe(
            "SRV _ldap._tcp.sadm.test (port 389)",
        );
        expect(describeExpectedRecord({ kind: "cname", name: "x._msdcs.sadm.test", essential: true })).toBe("CNAME x._msdcs.sadm.test");
    });
});
