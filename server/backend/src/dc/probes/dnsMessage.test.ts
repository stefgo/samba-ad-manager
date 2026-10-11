import { describe, expect, it } from "vitest";
import { decodeSoaAnswer, encodeSoaQuery } from "./dnsMessage.js";

// What the name servers of the development domain answered to the question below, id 0x1234:
// BIND 9.20 on a domain controller (BIND9_DLZ) and on the secondary.
const ANSWERS = {
    // The domain controller, for its own zone.
    primary: "EjSEAAABAAEAAAAABHNhZG0EdGVzdAAABgABwAwABgABAAAOEAAnA2RjMcAMCmhvc3RtYXN0ZXLADAAAACEAAAA8AAAAHgABUYAAAA4Q",
    // The secondary, for the zone it transfers: the same record, with the name servers behind it.
    secondary:
        "EjSEAAABAAEAAwADBHNhZG0EdGVzdAAABgABwAwABgABAAAOEAAnA2RjMcAMCmhvc3RtYXN0ZXLADAAAACEAAAA8AAAAHgABUYAAAA4QwAwAAgABAAADhAAGA25zMsAMwAwAAgABAAADhAAGA2RjMsAMwAwAAgABAAADhAACwCfAJwABAAEAAAOEAASsHAAVA0RDMsAMAAEAAQAAA4QABKwcABbAWgABAAEAAAOEAASsHAAe",
    // The secondary, for a zone it does not carry: it points at who does.
    referral: "EjSAAAABAAAAAQAABl9tc2RjcwRzYWRtBHRlc3QAAAYAAcAMAAIAAQAAA4QABgNkYzHAEw==",
    // The domain controller, for a zone that is nobody's here.
    refused: "EjSABQABAAAAAAAAB2V4YW1wbGUDbmV0AAAGAAE=",
} as const;

const ID = 0x1234;
const answer = (name: keyof typeof ANSWERS) => decodeSoaAnswer(new Uint8Array(Buffer.from(ANSWERS[name], "base64")), ID);

const SOA = {
    primary: "dc1.sadm.test",
    mailbox: "hostmaster.sadm.test",
    serial: 33,
    refresh: 60,
    retry: 30,
    expire: 86400,
    minimum: 3600,
};

describe("encodeSoaQuery", () => {
    it("asks for the SOA record of a zone, without asking for recursion", () => {
        expect(Buffer.from(encodeSoaQuery("sadm.test", ID)).toString("hex")).toBe(
            "1234" + "0000" + "0001" + "0000" + "0000" + "0000" + "047361646d" + "0474657374" + "00" + "0006" + "0001",
        );
    });

    it("takes a name with a dot at its end", () => {
        expect(encodeSoaQuery("sadm.test.", ID)).toEqual(encodeSoaQuery("sadm.test", ID));
    });

    it("refuses a label no name may have", () => {
        expect(() => encodeSoaQuery(`${"a".repeat(64)}.test`, ID)).toThrow(RangeError);
    });
});

describe("decodeSoaAnswer", () => {
    it("reads the record a domain controller answers with, and that it holds the zone", () => {
        expect(answer("primary")).toEqual({ authoritative: true, truncated: false, rcode: 0, rcodeText: null, soa: SOA });
    });

    it("reads the same record out of a longer answer, shortened names and all", () => {
        expect(answer("secondary")).toEqual({ authoritative: true, truncated: false, rcode: 0, rcodeText: null, soa: SOA });
    });

    it("sees a server that only points at who holds the zone", () => {
        expect(answer("referral")).toEqual({ authoritative: false, truncated: false, rcode: 0, rcodeText: null, soa: null });
    });

    it("reads a refusal", () => {
        expect(answer("refused")).toMatchObject({ rcode: 5, rcodeText: "refused (REFUSED)", soa: null });
    });

    it("says an answer was cut short instead of reading half of it", () => {
        const cut = new Uint8Array(Buffer.from(ANSWERS.primary, "base64")).slice(0, 40);
        cut[2] |= 0x02;
        expect(decodeSoaAnswer(cut, ID)).toMatchObject({ truncated: true, soa: null });
    });

    it("refuses what is no answer to the question", () => {
        const bytes = new Uint8Array(Buffer.from(ANSWERS.primary, "base64"));
        expect(() => decodeSoaAnswer(bytes, 0x4321)).toThrow("another question");
        expect(() => decodeSoaAnswer(bytes.slice(0, 8), ID)).toThrow("shorter");
        expect(() => decodeSoaAnswer(encodeSoaQuery("sadm.test", ID), ID)).toThrow("not a response");
    });

    it("does not follow a name that points at itself", () => {
        const bytes = new Uint8Array(Buffer.from(ANSWERS.primary, "base64"));
        // The answer's name is a pointer at offset 27; point it at itself.
        bytes[27] = 0xc0;
        bytes[28] = 27;
        expect(() => decodeSoaAnswer(bytes, ID)).toThrow("points at itself");
    });

    it("refuses an answer that ends inside a record", () => {
        const bytes = new Uint8Array(Buffer.from(ANSWERS.primary, "base64"));
        expect(() => decodeSoaAnswer(bytes.slice(0, bytes.length - 6), ID)).toThrow(RangeError);
    });
});
