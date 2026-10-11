import { describe, expect, it } from "vitest";
import {
    CreateDnsRecordSchema,
    DnsNodeNameSchema,
    DnsRecordInputSchema,
    UpdateDnsRecordSchema,
    dnsFqdn,
    dnsRecordConflict,
    dnsRecordText,
    dnsRecordTypeLabel,
    sameDnsRecord,
    type DnsRecordData,
} from "./dns.js";

const a = (address: string): DnsRecordData => ({ type: "A", address });
const cname = (target: string): DnsRecordData => ({ type: "CNAME", target });

describe("DnsRecordInputSchema", () => {
    const ok = (input: unknown) => DnsRecordInputSchema.safeParse(input).success;

    it("takes each type a record can be entered as", () => {
        expect(ok({ type: "A", address: "192.0.2.10" })).toBe(true);
        expect(ok({ type: "AAAA", address: "2001:db8::10" })).toBe(true);
        expect(ok({ type: "CNAME", target: "www.sadm.test" })).toBe(true);
        expect(ok({ type: "PTR", target: "host.sadm.test" })).toBe(true);
        expect(ok({ type: "TXT", strings: ["v=spf1 -all"] })).toBe(true);
        expect(ok({ type: "MX", preference: 10, exchange: "mail.sadm.test" })).toBe(true);
        expect(ok({ type: "SRV", priority: 0, weight: 100, port: 389, target: "dc1.sadm.test" })).toBe(true);
    });

    it("refuses the zone's own types, which are not entered here", () => {
        expect(ok({ type: "NS", target: "ns2.sadm.test" })).toBe(false);
        expect(ok({ type: "SOA" })).toBe(false);
    });

    it("refuses an address of the other family, and one that is none", () => {
        expect(ok({ type: "A", address: "2001:db8::10" })).toBe(false);
        expect(ok({ type: "AAAA", address: "192.0.2.10" })).toBe(false);
        expect(ok({ type: "A", address: "192.0.2.300" })).toBe(false);
    });

    it("drops the dot at the end of a host name, and refuses what is none", () => {
        expect(DnsRecordInputSchema.parse({ type: "CNAME", target: " www.sadm.test. " })).toEqual({ type: "CNAME", target: "www.sadm.test" });
        expect(ok({ type: "CNAME", target: "www sadm.test" })).toBe(false);
        expect(ok({ type: "CNAME", target: "-www.sadm.test" })).toBe(false);
        expect(ok({ type: "CNAME", target: "" })).toBe(false);
    });

    it("counts a text in bytes, of which a record takes 255 at a time", () => {
        expect(ok({ type: "TXT", strings: ["a".repeat(255)] })).toBe(true);
        expect(ok({ type: "TXT", strings: ["a".repeat(256)] })).toBe(false);
        // 128 characters of two bytes each.
        expect(ok({ type: "TXT", strings: ["ä".repeat(128)] })).toBe(false);
        expect(ok({ type: "TXT", strings: [] })).toBe(false);
    });

    it("keeps the numbers of a service record within what the record has room for", () => {
        expect(ok({ type: "SRV", priority: 0, weight: 0, port: 65536, target: "a.test" })).toBe(false);
        expect(ok({ type: "MX", preference: -1, exchange: "a.test" })).toBe(false);
    });
});

describe("DnsNodeNameSchema", () => {
    const ok = (name: string) => DnsNodeNameSchema.safeParse(name).success;

    it("takes a name within the zone, with dots and underscores, and the wildcard", () => {
        expect(ok("www")).toBe(true);
        expect(ok("a.b.c")).toBe(true);
        expect(ok("_sip._tcp")).toBe(true);
        expect(ok("*")).toBe(true);
        expect(ok("*.dev")).toBe(true);
    });

    it("refuses the zone itself, an empty label and a wildcard that is not the first label", () => {
        expect(ok("@")).toBe(false);
        expect(ok("www.")).toBe(false);
        expect(ok(".www")).toBe(false);
        expect(ok("a..b")).toBe(false);
        expect(ok("a.*")).toBe(false);
        expect(ok("")).toBe(false);
    });
});

describe("the requests", () => {
    it("gives a new record the usual TTL where none is named", () => {
        expect(CreateDnsRecordSchema.parse({ name: "www", record: { type: "A", address: "192.0.2.10" } }).ttl).toBe(900);
    });

    it("lets a record be replaced only by one of its type", () => {
        const change = (record: unknown) => UpdateDnsRecordSchema.safeParse({ old: a("192.0.2.10"), record, ttl: 300 }).success;
        expect(change({ type: "A", address: "192.0.2.11" })).toBe(true);
        expect(change({ type: "CNAME", target: "www.sadm.test" })).toBe(false);
    });
});

describe("sameDnsRecord", () => {
    it("tells records apart by what they say", () => {
        expect(sameDnsRecord(a("192.0.2.10"), a("192.0.2.10"))).toBe(true);
        expect(sameDnsRecord(a("192.0.2.10"), a("192.0.2.11"))).toBe(false);
        expect(sameDnsRecord(a("192.0.2.10"), { type: "AAAA", address: "192.0.2.10" })).toBe(false);
    });

    it("does not mind the case of a name or a dot at its end", () => {
        expect(sameDnsRecord(cname("WWW.sadm.test."), cname("www.sadm.test"))).toBe(true);
        expect(sameDnsRecord({ type: "AAAA", address: "2001:DB8::10" }, { type: "AAAA", address: "2001:db8::10" })).toBe(true);
    });

    it("compares every number of a service record", () => {
        const srv = (port: number): DnsRecordData => ({ type: "SRV", priority: 0, weight: 100, port, target: "dc1.sadm.test" });
        expect(sameDnsRecord(srv(389), srv(389))).toBe(true);
        expect(sameDnsRecord(srv(389), srv(636))).toBe(false);
    });

    it("compares the texts of a TXT record one by one, case and all", () => {
        const txt = (...strings: string[]): DnsRecordData => ({ type: "TXT", strings });
        expect(sameDnsRecord(txt("a", "b"), txt("a", "b"))).toBe(true);
        expect(sameDnsRecord(txt("a", "b"), txt("ab"))).toBe(false);
        expect(sameDnsRecord(txt("a"), txt("A"))).toBe(false);
    });
});

describe("dnsRecordConflict", () => {
    it("lets a second address stand next to the first", () => {
        expect(dnsRecordConflict([a("192.0.2.10")], a("192.0.2.11"))).toBeNull();
    });

    it("refuses a record the name has already", () => {
        expect(dnsRecordConflict([a("192.0.2.10")], a("192.0.2.10"))).toBe("The name has this record already");
    });

    it("refuses an alias next to anything, and anything next to an alias", () => {
        expect(dnsRecordConflict([a("192.0.2.10")], cname("www.sadm.test"))).toContain("stands alone");
        expect(dnsRecordConflict([cname("www.sadm.test")], a("192.0.2.10"))).toContain("is an alias");
        expect(dnsRecordConflict([cname("www.sadm.test")], cname("web.sadm.test"))).toContain("stands alone");
        expect(dnsRecordConflict([], cname("www.sadm.test"))).toBeNull();
    });

    it("does not count the record that is being replaced", () => {
        expect(dnsRecordConflict([cname("www.sadm.test")], cname("web.sadm.test"), cname("www.sadm.test"))).toBeNull();
        expect(dnsRecordConflict([a("192.0.2.10")], a("192.0.2.10"), a("192.0.2.10"))).toBeNull();
        // Changed into one that is there already.
        expect(dnsRecordConflict([a("192.0.2.10"), a("192.0.2.11")], a("192.0.2.11"), a("192.0.2.10"))).toBe("The name has this record already");
    });
});

describe("how a record reads", () => {
    it("names a zone's own name by the zone", () => {
        expect(dnsFqdn("@", "sadm.test")).toBe("sadm.test");
        expect(dnsFqdn("www", "sadm.test")).toBe("www.sadm.test");
    });

    it("writes a record the way a zone file would", () => {
        expect(dnsRecordText({ type: "MX", preference: 10, exchange: "mail.sadm.test" })).toBe("10 mail.sadm.test");
        expect(dnsRecordText({ type: "TXT", strings: ["a", "b c"] })).toBe('"a" "b c"');
        expect(dnsRecordTypeLabel({ type: "other", typeCode: 99, hex: "00" })).toBe("TYPE99");
    });
});
