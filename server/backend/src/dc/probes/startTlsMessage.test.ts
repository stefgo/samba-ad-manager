import { describe, expect, it } from "vitest";
import { readStartTlsAnswer, startTlsRequest } from "./startTlsMessage.js";

/** An ExtendedResponse with the given result code and message id 1, as a server writes it. */
const answer = (code: number, diagnostic = "") => {
    const text = [...Buffer.from(diagnostic, "ascii")];
    const op = [0x0a, 0x01, code, 0x04, 0x00, 0x04, text.length, ...text];
    const body = [0x02, 0x01, 0x01, 0x78, op.length, ...op];
    return Uint8Array.from([0x30, body.length, ...body]);
};

describe("startTlsRequest", () => {
    it("writes the extended request RFC 4511 describes, byte for byte", () => {
        expect(Buffer.from(startTlsRequest()).toString("hex")).toBe(
            "301d02010177188016" + Buffer.from("1.3.6.1.4.1.1466.20037", "ascii").toString("hex"),
        );
    });
});

describe("readStartTlsAnswer", () => {
    it("reads success", () => {
        expect(readStartTlsAnswer(answer(0))).toEqual({ complete: true, ok: true });
    });

    it("says why a server refused", () => {
        expect(readStartTlsAnswer(answer(52))).toEqual({ complete: true, ok: false, detail: "StartTLS refused: unavailable (52)" });
        expect(readStartTlsAnswer(answer(99))).toEqual({ complete: true, ok: false, detail: "StartTLS refused: result code (99)" });
    });

    it("waits for an answer that has not fully arrived", () => {
        const whole = answer(0, "a diagnostic message");
        for (const length of [0, 1, 2, whole.length - 1]) {
            expect(readStartTlsAnswer(whole.subarray(0, length))).toEqual({ complete: false });
        }
    });

    it("reads a length written in the long form", () => {
        const op = [0x0a, 0x01, 0x00, 0x04, 0x00, 0x04, 0x00];
        const body = [0x02, 0x01, 0x01, 0x78, 0x81, op.length, ...op];
        expect(readStartTlsAnswer(Uint8Array.from([0x30, 0x81, body.length, ...body]))).toEqual({ complete: true, ok: true });
    });

    it("refuses an answer that is something else", () => {
        expect(readStartTlsAnswer(Uint8Array.from([0x16, 0x03, 0x01, 0x00, 0x00]))).toMatchObject({ complete: true, ok: false });
        const search = Uint8Array.from([0x30, 0x05, 0x02, 0x01, 0x01, 0x65, 0x00]);
        expect(readStartTlsAnswer(search)).toEqual({ complete: true, ok: false, detail: "the answer is no response to StartTLS" });
    });
});
