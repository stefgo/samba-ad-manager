import { describe, expect, it } from "vitest";
import { encodeAsReq, isCompleteReply, kerberosReplyKind } from "./kerberos.js";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("encodeAsReq", () => {
    const request = encodeAsReq("SADM.TEST", 0x12345678, new Date("2026-10-11T00:01:00.000Z"));

    it("announces its own length, as Kerberos over TCP wants it", () => {
        expect(Buffer.from(request).readUInt32BE(0)).toBe(request.length - 4);
    });

    it("is an AS-REQ of protocol version 5", () => {
        // [APPLICATION 10] SEQUENCE { [1] INTEGER 5, [2] INTEGER 10, [4] req-body }
        expect(request[4]).toBe(0x6a);
        expect(hex(request)).toContain("a103020105" + "a20302010a");
    });

    it("asks for krbtgt of the realm, as a principal that does not exist", () => {
        const text = Buffer.from(request).toString("latin1");
        expect(text).toContain("sadm-health-probe");
        expect(text).toContain("krbtgt");
        expect(text).toContain("SADM.TEST");
        expect(text).toContain("20261011000100Z");
    });

    it("writes the nonce and the encryption types as DER integers", () => {
        expect(hex(request)).toContain("a706020412345678");
        expect(hex(request)).toContain("a8083006020112020111");
    });

    it("keeps a nonce with the high bit set positive", () => {
        expect(hex(encodeAsReq("X", 0x80, new Date(0)))).toContain("a70402020080");
    });
});

describe("the reply", () => {
    const framed = (...body: number[]) => {
        const reply = Buffer.alloc(4 + body.length);
        reply.writeUInt32BE(body.length, 0);
        reply.set(body, 4);
        return new Uint8Array(reply);
    };

    it("is whole once everything its length announces has arrived", () => {
        const reply = framed(0x7e, 0x03, 0x30, 0x01, 0x00);
        expect(isCompleteReply(reply)).toBe(true);
        expect(isCompleteReply(reply.subarray(0, 6))).toBe(false);
        expect(isCompleteReply(reply.subarray(0, 2))).toBe(false);
    });

    it("is told apart by its outermost tag", () => {
        expect(kerberosReplyKind(framed(0x7e, 0x00))).toBe("error");
        expect(kerberosReplyKind(framed(0x6b, 0x00))).toBe("as-rep");
        expect(kerberosReplyKind(framed(0x30, 0x00))).toBeNull();
        expect(kerberosReplyKind(framed())).toBeNull();
    });
});
