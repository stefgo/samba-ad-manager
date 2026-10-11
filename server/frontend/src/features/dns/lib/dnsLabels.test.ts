import { describe, expect, it } from "vitest";
import type { DnsNode } from "@sadm/shared";
import { isReverseZone, matchesRecordSearch, recordRows, recordSortName } from "./dnsLabels";

const node = (name: string, records: DnsNode["records"]): DnsNode => ({
    guid: `guid-${name}`,
    name,
    fqdn: name === "@" ? "sadm.test" : `${name}.sadm.test`,
    protected: name === "@",
    records,
});

const a = (address: string): DnsNode["records"][number] => ({
    data: { type: "A", address },
    ttl: 900,
    registeredAt: null,
    protected: false,
    deletable: true,
});

const NODES: DnsNode[] = [
    node("@", [{ data: { type: "NS", target: "dc1.sadm.test" }, ttl: 900, registeredAt: null, protected: true, deletable: false }]),
    node("www", [a("192.0.2.10"), a("192.0.2.11")]),
    node("mail", [
        { data: { type: "MX", preference: 10, exchange: "mx.sadm.test" }, ttl: 900, registeredAt: null, protected: false, deletable: true },
        { data: { type: "other", typeCode: 99, hex: "c0" }, ttl: 900, registeredAt: null, protected: false, deletable: true },
    ]),
];

describe("recordRows", () => {
    const rows = recordRows(NODES);

    it("makes a row of every record, with a key of its own", () => {
        expect(rows).toHaveLength(5);
        expect(new Set(rows.map((row) => row.key)).size).toBe(5);
    });

    it("says what each record is and says", () => {
        expect(rows.map((row) => `${row.type} ${row.text}`)).toEqual([
            "NS dc1.sadm.test",
            "A 192.0.2.10",
            "A 192.0.2.11",
            "MX 10 mx.sadm.test",
            "TYPE99 c0",
        ]);
    });

    it("sorts the zone itself before every name", () => {
        const sorted = [...rows].sort((x, y) => recordSortName(x).localeCompare(recordSortName(y)));
        expect(sorted[0].node.name).toBe("@");
    });
});

describe("matchesRecordSearch", () => {
    const rows = recordRows(NODES);
    const hits = (query: string) => rows.filter((row) => matchesRecordSearch(row, query)).map((row) => row.node.name);

    it("finds a record by its name, in the zone or in full", () => {
        expect(hits("www")).toEqual(["www", "www"]);
        expect(hits("mail.sadm.test")).toEqual(["mail", "mail"]);
    });

    it("finds a record by its type and by what it says", () => {
        expect(hits("mx")).toEqual(["mail"]);
        expect(hits("192.0.2.11")).toEqual(["www"]);
    });

    it("finds everything for no query", () => {
        expect(hits("  ")).toHaveLength(5);
    });
});

describe("isReverseZone", () => {
    it("knows a zone that maps addresses back to names", () => {
        expect(isReverseZone({ name: "2.0.192.in-addr.arpa" })).toBe(true);
        expect(isReverseZone({ name: "8.b.d.0.1.0.0.2.ip6.arpa" })).toBe(true);
        expect(isReverseZone({ name: "sadm.test" })).toBe(false);
    });
});
