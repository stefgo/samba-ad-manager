/**
 * The StartTLS request of LDAP (RFC 4511, 4.14) and what a server says to it, as they go over
 * the wire.
 *
 * Written out here rather than asked through ldapts: its client upgrades the connection, but
 * keeps the socket to itself, and what this server wants of the exchange is the certificate
 * the other side presents afterwards. The request is one extended operation with nothing
 * that varies; the answer is read only as far as its result code.
 */

/** The name of the extended operation: `1.3.6.1.4.1.1466.20037`. */
const START_TLS_OID = "1.3.6.1.4.1.1466.20037";

const TAG_SEQUENCE = 0x30;
const TAG_INTEGER = 0x02;
const TAG_ENUMERATED = 0x0a;
/** `[APPLICATION 23]` ExtendedRequest and `[APPLICATION 24]` ExtendedResponse, both constructed. */
const TAG_EXTENDED_REQUEST = 0x77;
const TAG_EXTENDED_RESPONSE = 0x78;
/** `[0]` requestName of an ExtendedRequest. */
const TAG_REQUEST_NAME = 0x80;

/** What some result codes read as (RFC 4511, appendix A). */
const RESULT_CODES: Record<number, string> = {
    1: "operations error",
    2: "protocol error",
    12: "unavailable critical extension",
    51: "busy",
    52: "unavailable",
    53: "unwilling to perform",
    80: "other",
};

/** A length in BER: one byte up to 127, otherwise one byte that says how many follow. */
function berLength(length: number): number[] {
    if (length < 0x80) return [length];
    const bytes: number[] = [];
    for (let rest = length; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
    return [0x80 | bytes.length, ...bytes];
}

const tlv = (tag: number, value: readonly number[]): number[] => [tag, ...berLength(value.length), ...value];

/** The StartTLS request with the given message id. */
export function startTlsRequest(messageId = 1): Uint8Array {
    const name = [...Buffer.from(START_TLS_OID, "ascii")];
    return Uint8Array.from(tlv(TAG_SEQUENCE, [...tlv(TAG_INTEGER, [messageId]), ...tlv(TAG_EXTENDED_REQUEST, tlv(TAG_REQUEST_NAME, name))]));
}

interface Tlv {
    tag: number;
    start: number;
    end: number;
}

/** The element at `offset`; null while it has not fully arrived, or where it cannot be read. */
function readTlv(buffer: Uint8Array, offset: number): Tlv | null {
    if (offset + 2 > buffer.length) return null;
    const tag = buffer[offset];
    let length = buffer[offset + 1];
    let start = offset + 2;
    if (length & 0x80) {
        const count = length & 0x7f;
        if (count === 0 || count > 4 || start + count > buffer.length) return null;
        length = 0;
        for (let i = 0; i < count; i++) length = length * 256 + buffer[start + i];
        start += count;
    }
    const end = start + length;
    return end > buffer.length ? null : { tag, start, end };
}

export type StartTlsAnswer =
    /** Not all of it has arrived yet. */
    | { complete: false }
    | { complete: true; ok: true }
    | { complete: true; ok: false; detail: string };

/**
 * Reads the answer to `startTlsRequest`. A server that does not offer StartTLS says so with
 * a result code; one that is about to close the connection sends a notice of disconnection,
 * which is an extended response as well.
 */
export function readStartTlsAnswer(buffer: Uint8Array): StartTlsAnswer {
    const message = readTlv(buffer, 0);
    if (!message) return { complete: false };
    const refused = (detail: string): StartTlsAnswer => ({ complete: true, ok: false, detail });
    if (message.tag !== TAG_SEQUENCE) return refused("the answer is no LDAP message");

    const id = readTlv(buffer, message.start);
    const op = id && readTlv(buffer, id.end);
    if (!id || id.tag !== TAG_INTEGER || !op) return refused("the answer is no LDAP message");
    if (op.tag !== TAG_EXTENDED_RESPONSE) return refused("the answer is no response to StartTLS");

    const result = readTlv(buffer, op.start);
    if (!result || result.tag !== TAG_ENUMERATED || result.end - result.start !== 1) return refused("the answer carries no result code");
    const code = buffer[result.start];
    if (code === 0) return { complete: true, ok: true };
    return refused(`StartTLS refused: ${RESULT_CODES[code] ?? "result code"} (${code})`);
}
