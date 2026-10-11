import { describe, expect, it } from "vitest";
import { CreateDnsRecordSchema, UpdateDnsRecordSchema, type DnsRecord } from "@sadm/shared";
import { checkDraft } from "../../../lib/entityForm";
import {
    RECORD_FIELDS,
    createRecordInputFrom,
    recordDraftFrom,
    recordFieldOf,
    recordInputFrom,
    updateRecordInputFrom,
    type RecordDraft,
} from "./recordForm";

const record = (data: DnsRecord["data"], ttl = 900): DnsRecord => ({ data, ttl, registeredAt: null, protected: false, deletable: true });

const check = (draft: RecordDraft) => checkDraft({ schema: CreateDnsRecordSchema, toInput: createRecordInputFrom, fieldOf: recordFieldOf }, draft);

describe("recordDraftFrom", () => {
    it("opens a new record empty, as an address, with the usual TTL", () => {
        expect(recordDraftFrom(null)).toMatchObject({ name: "", type: "A", address: "", ttl: "900" });
    });

    it("opens a change with what the record says", () => {
        expect(recordDraftFrom(record({ type: "MX", preference: 20, exchange: "mx.sadm.test" }, 300), "@")).toMatchObject({
            name: "@",
            type: "MX",
            preference: "20",
            exchange: "mx.sadm.test",
            ttl: "300",
        });
        expect(recordDraftFrom(record({ type: "TXT", strings: ["a", "b c"] }), "x").text).toBe("a\nb c");
    });

    it("reads back as the record it was opened from, for every type", () => {
        const all: DnsRecord["data"][] = [
            { type: "A", address: "192.0.2.10" },
            { type: "AAAA", address: "2001:db8::10" },
            { type: "CNAME", target: "www.sadm.test" },
            { type: "PTR", target: "host.sadm.test" },
            { type: "TXT", strings: ["v=spf1 -all", "second"] },
            { type: "MX", preference: 10, exchange: "mail.sadm.test" },
            { type: "SRV", priority: 5, weight: 20, port: 8080, target: "app.sadm.test" },
        ];
        for (const data of all) expect(recordInputFrom(recordDraftFrom(record(data), "x"))).toEqual(data);
    });
});

describe("the request", () => {
    const draft = (over: Partial<RecordDraft>): RecordDraft => ({ ...recordDraftFrom(null, "www"), ...over });

    it("carries the name, the record and the TTL of a new record", () => {
        expect(createRecordInputFrom(draft({ address: " 192.0.2.10 ", ttl: "300" }))).toEqual({
            name: "www",
            record: { type: "A", address: "192.0.2.10" },
            ttl: 300,
        });
    });

    it("names the record a change replaces by what it said", () => {
        const old = { type: "A" as const, address: "192.0.2.10" };
        const input = updateRecordInputFrom(draft({ address: "192.0.2.11" }), old);
        expect(input).toEqual({ old, record: { type: "A", address: "192.0.2.11" }, ttl: 900 });
        expect(UpdateDnsRecordSchema.safeParse(input).success).toBe(true);
    });

    it("makes one text of every line of a TXT record, and none of an empty one", () => {
        expect(recordInputFrom(draft({ type: "TXT", text: "v=spf1 -all\n\nsecond\n" }))).toEqual({
            type: "TXT",
            strings: ["v=spf1 -all", "second"],
        });
    });
});

describe("what is wrong, and where it is said", () => {
    const draft = (over: Partial<RecordDraft>): RecordDraft => ({ ...recordDraftFrom(null, "www"), address: "192.0.2.10", ...over });

    it("has nothing to say about a record that is fine", () => {
        expect(check(draft({})).isValid).toBe(true);
    });

    it("says at the address that it is none, or of the other family", () => {
        expect(check(draft({ address: "192.0.2" })).errors.address).toBe("Must be an IPv4 address");
        expect(check(draft({ type: "AAAA" })).errors.address).toBe("Must be an IPv6 address");
    });

    it("says at the name that the zone's own records are not entered here", () => {
        expect(check(draft({ name: "@" })).errors.name).toContain("Must be a name within the zone");
    });

    it("says at a number that it is none, or too large", () => {
        const srv = draft({ type: "SRV", target: "app.sadm.test", port: "http" });
        expect(check(srv).errors.port).toBeDefined();
        expect(check({ ...srv, port: "70000" }).errors.port).toBeDefined();
        expect(check({ ...srv, port: "8080" }).isValid).toBe(true);
        expect(check(draft({ ttl: "soon" })).errors.ttl).toBeDefined();
    });

    it("says at the text that a line is too long, or that there is none", () => {
        expect(check(draft({ type: "TXT", text: "a".repeat(256) })).errors.text).toBe("At most 255 bytes per text");
        expect(check(draft({ type: "TXT", text: "" })).errors.text).toBe("At least one text");
    });

    it("does not hold a field against a type that does not show it", () => {
        // An address left over from before the type was changed.
        expect(check(draft({ type: "CNAME", address: "nonsense", target: "www.sadm.test" })).isValid).toBe(true);
    });
});

describe("RECORD_FIELDS", () => {
    it("shows for every type exactly the fields its record is built from", () => {
        for (const [type, fields] of Object.entries(RECORD_FIELDS)) {
            const filled = { ...recordDraftFrom(null, "x"), type, address: "192.0.2.1", target: "t.test", exchange: "m.test", port: "1", text: "t" } as RecordDraft;
            if (type === "AAAA") filled.address = "2001:db8::1";
            const input = recordInputFrom(filled) as Record<string, unknown>;
            const sent = Object.keys(input).filter((key) => key !== "type").map((key) => (key === "strings" ? "text" : key));
            expect(sent.sort(), type).toEqual([...fields].sort());
        }
    });
});
