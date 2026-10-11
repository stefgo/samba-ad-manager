/**
 * One DNS question and its answer, as they go over the wire (RFC 1035): the request for the
 * SOA record of a zone, and what a name server says to it.
 *
 * Written out here rather than asked through `node:dns`: that hands back the record and
 * nothing else. What this server wants to know is in the header -- whether the server
 * answered with authority, as one that holds the zone, or as one that looked it up -- and
 * the question has to go out without asking for recursion, or a resolver would answer for
 * a zone it only knows by hearsay.
 */

const TYPE_SOA = 6;
const CLASS_IN = 1;

const FLAG_RESPONSE = 0x8000;
const FLAG_AUTHORITATIVE = 0x0400;
const FLAG_TRUNCATED = 0x0200;

/** What a response code reads as. */
const RCODES: Record<number, string> = {
    1: "format error (FORMERR)",
    2: "server failure (SERVFAIL)",
    3: "no such zone (NXDOMAIN)",
    4: "not implemented (NOTIMP)",
    5: "refused (REFUSED)",
    9: "not authoritative (NOTAUTH)",
};

export interface SoaAnswer {
    /** Whether the server answered as one that holds the zone. */
    authoritative: boolean;
    /** Cut short to fit a datagram: the whole answer has to be asked for over TCP. */
    truncated: boolean;
    /** 0 is "no error". */
    rcode: number;
    rcodeText: string | null;
    /** The zone's SOA record; null when the answer carries none. */
    soa: { serial: number; refresh: number; retry: number; expire: number; minimum: number; primary: string; mailbox: string } | null;
}

/** A host name as labels, each behind its length, and a zero. */
function encodeName(name: string): number[] {
    const bytes: number[] = [];
    for (const label of name.replace(/\.$/, "").split(".")) {
        if (!label) continue;
        const encoded = Buffer.from(label, "utf8");
        if (encoded.length > 63) throw new RangeError(`A label of ${name} is longer than 63 bytes`);
        bytes.push(encoded.length, ...encoded);
    }
    bytes.push(0);
    return bytes;
}

/** The question for the SOA record of `zone`, with recursion not asked for. */
export function encodeSoaQuery(zone: string, id: number): Uint8Array {
    const header = [(id >> 8) & 0xff, id & 0xff, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    return new Uint8Array([...header, ...encodeName(zone), 0, TYPE_SOA, 0, CLASS_IN]);
}

/**
 * A name at `offset`, following the pointers a server shortens repeated names with. Returns
 * the name and where reading goes on behind it -- behind the first pointer, not its target.
 */
function readName(message: Uint8Array, offset: number): { name: string; next: number } {
    const labels: string[] = [];
    let at = offset;
    let next = -1;
    // A message is at most 64 KiB, so more jumps than this is a loop somebody built.
    for (let jumps = 0; jumps < 128; ) {
        if (at >= message.length) throw new RangeError("A name runs past the end of the message");
        const length = message[at];
        if (length === 0) {
            return { name: labels.join("."), next: next < 0 ? at + 1 : next };
        }
        if ((length & 0xc0) === 0xc0) {
            if (at + 1 >= message.length) throw new RangeError("A pointer runs past the end of the message");
            if (next < 0) next = at + 2;
            at = ((length & 0x3f) << 8) | message[at + 1];
            jumps++;
            continue;
        }
        if (at + 1 + length > message.length) throw new RangeError("A label runs past the end of the message");
        labels.push(Buffer.from(message.subarray(at + 1, at + 1 + length)).toString("utf8"));
        at += 1 + length;
    }
    throw new RangeError("A name points at itself");
}

/**
 * Reads the answer to `encodeSoaQuery`. Throws for what is no answer to that question: too
 * short, not a response, another id.
 */
export function decodeSoaAnswer(message: Uint8Array, id: number): SoaAnswer {
    if (message.length < 12) throw new RangeError("The answer is shorter than a DNS header");
    const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
    if (view.getUint16(0) !== id) throw new RangeError("The answer is to another question");
    const flags = view.getUint16(2);
    if (!(flags & FLAG_RESPONSE)) throw new RangeError("What came back is not a response");

    const rcode = flags & 0x000f;
    const answer: SoaAnswer = {
        authoritative: (flags & FLAG_AUTHORITATIVE) !== 0,
        truncated: (flags & FLAG_TRUNCATED) !== 0,
        rcode,
        rcodeText: rcode === 0 ? null : (RCODES[rcode] ?? `response code ${rcode}`),
        soa: null,
    };
    // What was cut short is asked for again; reading half a record would only fail.
    if (answer.truncated) return answer;

    let at = 12;
    for (let i = view.getUint16(4); i > 0; i--) at = readName(message, at).next + 4;
    for (let i = view.getUint16(6); i > 0; i--) {
        at = readName(message, at).next;
        if (at + 10 > message.length) throw new RangeError("A record runs past the end of the message");
        const type = view.getUint16(at);
        const length = view.getUint16(at + 8);
        const data = at + 10;
        if (data + length > message.length) throw new RangeError("A record runs past the end of the message");
        if (type === TYPE_SOA && !answer.soa) {
            const primary = readName(message, data);
            const mailbox = readName(message, primary.next);
            const numbers = mailbox.next;
            if (numbers + 20 > message.length) throw new RangeError("The SOA record is cut short");
            answer.soa = {
                primary: primary.name,
                mailbox: mailbox.name,
                serial: view.getUint32(numbers),
                refresh: view.getUint32(numbers + 4),
                retry: view.getUint32(numbers + 8),
                expire: view.getUint32(numbers + 12),
                minimum: view.getUint32(numbers + 16),
            };
        }
        at = data + length;
    }
    return answer;
}
