import { exchangeTcp, socketReason, type ProbeResult } from "./tcp.js";

/**
 * Asks the KDC for a ticket it will not give, and takes the refusal as the sign of life.
 *
 * The request is an AS-REQ (RFC 4120) for a principal that does not exist. A KDC that works
 * answers it with a KRB-ERROR -- "client not found" -- having parsed the request and looked
 * the name up in its database; no password is involved and no account's failed-logon
 * counter moves. Any well-formed reply counts: the question is whether the KDC answers.
 *
 * Written out here rather than taken from a Kerberos library: those bind to the system's
 * GSSAPI, and this needs forty bytes of DER.
 */

/** The client name of the probe. Chosen to say what it is in the KDC's log. */
const PROBE_PRINCIPAL = "sadm-health-probe";

const MSG_AS_REQ = 10;
const NT_PRINCIPAL = 1;
const NT_SRV_INST = 2;
/** aes256-cts-hmac-sha1-96, aes128-cts-hmac-sha1-96: what every current KDC offers. */
const ETYPES = [18, 17];

function length(n: number): number[] {
    if (n < 0x80) return [n];
    const bytes: number[] = [];
    for (let rest = n; rest > 0; rest >>>= 8) bytes.unshift(rest & 0xff);
    return [0x80 | bytes.length, ...bytes];
}

const tlv = (tag: number, content: number[]): number[] => [tag, ...length(content.length), ...content];
const sequence = (...items: number[][]) => tlv(0x30, items.flat());
const context = (n: number, content: number[]) => tlv(0xa0 | n, content);
const generalString = (text: string) => tlv(0x1b, [...Buffer.from(text, "ascii")]);

function integer(value: number): number[] {
    const bytes: number[] = [];
    let rest = value;
    do {
        bytes.unshift(rest & 0xff);
        rest = Math.floor(rest / 256);
    } while (rest > 0);
    // A leading one bit would make it negative.
    if (bytes[0] & 0x80) bytes.unshift(0);
    return tlv(0x02, bytes);
}

const principal = (type: number, ...names: string[]) =>
    sequence(context(0, integer(type)), context(1, sequence(...names.map(generalString))));

/** `YYYYMMDDHHMMSSZ` */
const kerberosTime = (date: Date) => tlv(0x18, [...Buffer.from(date.toISOString().replace(/[-:]|\.\d+/g, "").replace("T", ""), "ascii")]);

/** The AS-REQ for the probe principal in `realm`, as it goes on the wire over TCP: length first. */
export function encodeAsReq(realm: string, nonce: number, till: Date): Uint8Array {
    const body = sequence(
        // kdc-options: none.
        context(0, tlv(0x03, [0, 0, 0, 0, 0])),
        context(1, principal(NT_PRINCIPAL, PROBE_PRINCIPAL)),
        context(2, generalString(realm)),
        context(3, principal(NT_SRV_INST, "krbtgt", realm)),
        context(5, kerberosTime(till)),
        context(7, integer(nonce)),
        context(8, sequence(...ETYPES.map(integer))),
    );
    const request = tlv(0x60 | MSG_AS_REQ, sequence(context(1, integer(5)), context(2, integer(MSG_AS_REQ)), context(4, body)));
    const framed = Buffer.alloc(4 + request.length);
    framed.writeUInt32BE(request.length, 0);
    framed.set(request, 4);
    return new Uint8Array(framed);
}

/** Whether everything the length prefix announces has arrived. */
export function isCompleteReply(received: Uint8Array): boolean {
    if (received.length < 4) return false;
    return received.length >= 4 + Buffer.from(received.buffer, received.byteOffset, 4).readUInt32BE(0);
}

/**
 * What a reply is: an AS-REP, a KRB-ERROR, or neither. The tag of the outermost element says
 * it -- `[APPLICATION 11]` and `[APPLICATION 30]` -- and nothing further in is needed.
 */
export function kerberosReplyKind(received: Uint8Array): "as-rep" | "error" | null {
    if (!isCompleteReply(received) || received.length < 5) return null;
    switch (received[4]) {
        case 0x6b:
            return "as-rep";
        case 0x7e:
            return "error";
        default:
            return null;
    }
}

export async function probeKerberos(host: string, realm: string, timeoutMs: number): Promise<ProbeResult> {
    const started = Date.now();
    const nonce = Math.floor(Math.random() * 0x7fffffff);
    const request = encodeAsReq(realm.toUpperCase(), nonce, new Date(started + 60_000));
    try {
        const reply = await exchangeTcp(host, 88, request, isCompleteReply, timeoutMs);
        return kerberosReplyKind(reply)
            ? { ok: true, latencyMs: Date.now() - started }
            : { ok: false, detail: "answered with something that is not Kerberos" };
    } catch (err) {
        return { ok: false, detail: socketReason(err) };
    }
}
