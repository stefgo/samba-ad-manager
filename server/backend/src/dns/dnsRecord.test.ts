import { describe, expect, it } from "vitest";
import type { DnsRecordData } from "@sadm/shared";
import { decodeDnsRecord, encodeDnsRecord, formatIpv6, ipv6Bytes, isoOfDnsTimestamp, staticHead } from "./dnsRecord.js";

// Read off the zone sadm.test on a Samba 4.22 domain controller, with `ldbsearch`. Every
// record but the dynamic one and the tombstone was entered with `samba-tool dns add`.
const RECORDS = {
    a: "BAABAAXwAAAXAAAAAAADhAAAAAAAAAAAwAACCg==",
    aaaa: "EAAcAAXwAAAZAAAAAAADhAAAAAAAAAAAIAENuAAAAAAAAAAAAAAAEA==",
    cname: "EgAFAAXwAAAaAAAAAAADhAAAAAAAAAAAEAMEZngtYQRzYWRtBHRlc3QA",
    ptr: "EgAMAAXwAAAbAAAAAAADhAAAAAAAAAAAEAMEZngtYQRzYWRtBHRlc3QA",
    ns: "EQACAAXwAAAgAAAAAAADhAAAAAAAAAAADwMDbnMyBHNhZG0EdGVzdAA=",
    txt: "GgAQAAXwAAAcAAAAAAADhAAAAAAAAAAAC3Y9c3BmMSAtYWxsDXNlY29uZCBzdHJpbmc=",
    mx: "FAAPAAXwAAAdAAAAAAADhAAAAAAAAAAAAAoQAwRtYWlsBHNhZG0EdGVzdAA=",
    srv: "GAAhAAXwAAAeAAAAAAADhAAAAAAAAAAAAAUAFB+QEAMEZngtYQRzYWRtBHRlc3QA",
    soa: "PQAGAAXwAAAgAAAAAAAOEAAAAAAAAAAAAAAAIQAAADwAAAAeAAFRgAAADhAPAwNkYzEEc2FkbQR0ZXN0ABYDCmhvc3RtYXN0ZXIEc2FkbQR0ZXN0AA==",
    // Registered with `nsupdate -g`, which is how a client registers itself.
    dynamic: "BAABAAXwAAAfAAAAAAABLAAAAAA18zgAwAACFA==",
    // What is left of a name that was deleted the same way.
    tombstone: "CAAAAAUAAAAgAAAAAAAAAAAAAAAAAAAATkF7eoNZ3QE=",
    // A root server, which the zone RootDNSServers lists with another rank.
    rootHint: "FgACAAUIAAAAAAAAAAAAAAAAAAAAAAAAFAMBYQxyb290LXNlcnZlcnMDbmV0AA==",
} as const;

const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));
const decode = (name: keyof typeof RECORDS) => decodeDnsRecord(bytes(RECORDS[name]));

describe("decodeDnsRecord", () => {
    it("reads an address with the head every record of a zone has", () => {
        expect(decode("a")).toEqual({
            head: { rank: 0xf0, flags: 0, serial: 23, ttl: 900, reserved: 0, timestamp: 0 },
            data: { type: "A", address: "192.0.2.10" },
        });
    });

    it("reads each type as samba-tool was given it", () => {
        expect(decode("aaaa")?.data).toEqual({ type: "AAAA", address: "2001:db8::10" });
        expect(decode("cname")?.data).toEqual({ type: "CNAME", target: "fx-a.sadm.test" });
        expect(decode("ptr")?.data).toEqual({ type: "PTR", target: "fx-a.sadm.test" });
        expect(decode("ns")?.data).toEqual({ type: "NS", target: "ns2.sadm.test" });
        expect(decode("txt")?.data).toEqual({ type: "TXT", strings: ["v=spf1 -all", "second string"] });
        expect(decode("mx")?.data).toEqual({ type: "MX", preference: 10, exchange: "mail.sadm.test" });
        expect(decode("srv")?.data).toEqual({ type: "SRV", priority: 5, weight: 20, port: 8080, target: "fx-a.sadm.test" });
    });

    it("reads the zone's own record, whose serial number is not the one in its head", () => {
        const soa = decode("soa");
        expect(soa?.head.serial).toBe(32);
        expect(soa?.head.ttl).toBe(3600);
        expect(soa?.data).toEqual({
            type: "SOA",
            serial: 33,
            refresh: 60,
            retry: 30,
            expire: 86400,
            minimum: 3600,
            primary: "dc1.sadm.test",
            mailbox: "hostmaster.sadm.test",
        });
    });

    it("tells a record a client registered by its time stamp", () => {
        const dynamic = decode("dynamic");
        expect(dynamic?.data).toEqual({ type: "A", address: "192.0.2.20" });
        expect(dynamic?.head.ttl).toBe(300);
        expect(isoOfDnsTimestamp(dynamic!.head.timestamp)).toBe("2026-10-11T13:00:00.000Z");
        expect(isoOfDnsTimestamp(decode("a")!.head.timestamp)).toBeNull();
    });

    it("reads what is left of a deleted name as a tombstone", () => {
        expect(decode("tombstone")?.data).toEqual({ type: "tombstone" });
    });

    it("reads a record of another rank", () => {
        const hint = decode("rootHint");
        expect(hint?.head.rank).toBe(8);
        expect(hint?.data).toEqual({ type: "NS", target: "a.root-servers.net" });
    });

    it("keeps a type it does not know, with its number and its bytes", () => {
        const unknown = bytes(RECORDS.a);
        new DataView(unknown.buffer).setUint16(2, 99, true);
        expect(decodeDnsRecord(unknown)?.data).toEqual({ type: "other", typeCode: 99, hex: "c000020a" });
    });

    it("keeps a record whose data does not read as its type should", () => {
        // An SRV record cut off inside its target.
        const full = bytes(RECORDS.srv);
        const cut = full.slice(0, full.length - 6);
        new DataView(cut.buffer).setUint16(0, cut.length - 24, true);
        expect(decodeDnsRecord(cut)?.data).toMatchObject({ type: "other", typeCode: 33 });
    });

    it("refuses what is no record: too short, a length that does not fit, another version", () => {
        expect(decodeDnsRecord(new Uint8Array(10))).toBeNull();
        expect(decodeDnsRecord(bytes(RECORDS.a).slice(0, 27))).toBeNull();
        const otherVersion = bytes(RECORDS.a);
        otherVersion[4] = 4;
        expect(decodeDnsRecord(otherVersion)).toBeNull();
    });
});

describe("formatIpv6", () => {
    const format = (groups: number[]) => formatIpv6(new Uint8Array(groups.flatMap((group) => [group >> 8, group & 0xff])));

    it("shortens the longest run of zeros, and the first of two equally long ones", () => {
        expect(format([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1])).toBe("2001:db8::1");
        expect(format([0x2001, 0, 0, 1, 0, 0, 0, 1])).toBe("2001:0:0:1::1");
        expect(format([0x2001, 0, 0, 1, 0, 0, 1, 1])).toBe("2001::1:0:0:1:1");
    });

    it("writes a single zero group out", () => {
        expect(format([0x2001, 0xdb8, 0, 1, 1, 1, 1, 1])).toBe("2001:db8:0:1:1:1:1:1");
    });

    it("writes the ends", () => {
        expect(format([0, 0, 0, 0, 0, 0, 0, 0])).toBe("::");
        expect(format([0, 0, 0, 0, 0, 0, 0, 1])).toBe("::1");
        expect(format([0xfe80, 0, 0, 0, 0, 0, 0, 0])).toBe("fe80::");
    });
});

describe("encodeDnsRecord", () => {
    it("writes every record that was read back as the bytes it was read from", () => {
        for (const [name, base64] of Object.entries(RECORDS)) {
            // A tombstone is nothing this server writes.
            if (name === "tombstone") continue;
            const decoded = decodeDnsRecord(bytes(base64))!;
            const written = encodeDnsRecord(decoded.head, decoded.data as DnsRecordData);
            expect(Buffer.from(written).toString("base64"), name).toBe(base64);
        }
    });

    it("writes a new record as samba-tool does: of the zone, at the serial number given, not ageing", () => {
        // RECORDS.a, which samba-tool wrote at serial 23 with its usual TTL.
        const written = encodeDnsRecord(staticHead(23, 900), { type: "A", address: "192.0.2.10" });
        expect(Buffer.from(written).toString("base64")).toBe(RECORDS.a);
    });

    it("writes a name the same whatever dot it ends in", () => {
        const head = staticHead(26, 900);
        expect(encodeDnsRecord(head, { type: "CNAME", target: "fx-a.sadm.test." })).toEqual(
            encodeDnsRecord(head, { type: "CNAME", target: "fx-a.sadm.test" }),
        );
        expect(Buffer.from(encodeDnsRecord(head, { type: "CNAME", target: "fx-a.sadm.test." })).toString("base64")).toBe(RECORDS.cname);
    });

    it("refuses what does not fit a record", () => {
        const head = staticHead(1, 900);
        expect(() => encodeDnsRecord(head, { type: "A", address: "192.0.2" })).toThrow(RangeError);
        expect(() => encodeDnsRecord(head, { type: "AAAA", address: "2001:db8::1::2" })).toThrow(RangeError);
        expect(() => encodeDnsRecord(head, { type: "CNAME", target: `${"a".repeat(64)}.test` })).toThrow(RangeError);
        expect(() => encodeDnsRecord(head, { type: "TXT", strings: ["a".repeat(256)] })).toThrow(RangeError);
    });
});

describe("ipv6Bytes", () => {
    const hex = (address: string) => Buffer.from(ipv6Bytes(address)).toString("hex");

    it("reads an address however it is shortened", () => {
        expect(hex("2001:db8::10")).toBe("20010db8000000000000000000000010");
        expect(hex("2001:0DB8:0:0:0:0:0:10")).toBe("20010db8000000000000000000000010");
        expect(hex("::1")).toBe("00000000000000000000000000000001");
        expect(hex("fe80::")).toBe("fe800000000000000000000000000000");
        expect(hex("::")).toBe("00000000000000000000000000000000");
    });

    it("reads an address that ends in an IPv4 one", () => {
        expect(hex("::ffff:192.0.2.10")).toBe("00000000000000000000ffffc000020a");
    });

    it("is what formatIpv6 reads back", () => {
        for (const address of ["2001:db8::10", "::1", "fe80::", "2001:db8:0:1:1:1:1:1", "::"]) {
            expect(formatIpv6(new Uint8Array(ipv6Bytes(address)))).toBe(address);
        }
    });

    it("refuses what is no address", () => {
        for (const address of ["2001:db8", "1:2:3:4:5:6:7:8:9", "2001:db8::g", "1::2::3", "1:2:3:4:5:6:7::8"]) {
            expect(() => ipv6Bytes(address), address).toThrow(RangeError);
        }
    });
});
