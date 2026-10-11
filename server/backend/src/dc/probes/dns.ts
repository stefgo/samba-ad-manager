import crypto from "crypto";
import dgram from "dgram";
import net from "net";
import { decodeSoaAnswer, encodeSoaQuery, type SoaAnswer } from "./dnsMessage.js";
import { exchangeTcp, socketReason, type ProbeResult } from "./tcp.js";

/** What a name server said when it was asked for the SOA record of a zone. */
export interface ZoneProbe extends ProbeResult {
    /** Whether a DNS server answered at all -- whatever it said about the zone. */
    answered: boolean;
    /** The zone's serial number, and how often a secondary is to ask for it. */
    serial?: number;
    refresh?: number;
    retry?: number;
}

/** One question over UDP, and the datagram that comes back. */
function exchangeUdp(address: string, request: Uint8Array, timeoutMs: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket(net.isIPv6(address) ? "udp6" : "udp4");
        const timer = setTimeout(() => finish(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })), timeoutMs);
        const finish = (err: unknown, message?: Buffer) => {
            clearTimeout(timer);
            socket.close();
            if (message) resolve(message);
            else reject(err);
        };
        socket.once("error", (err) => finish(err));
        // Only what comes from the server that was asked is its answer.
        socket.on("message", (message, from) => {
            if (from.port === 53) finish(null, message);
        });
        socket.send(request, 53, address, (err) => {
            if (err) finish(err);
        });
    });
}

/** The same question over TCP, where a message goes behind its length. */
async function exchangeOverTcp(address: string, request: Uint8Array, timeoutMs: number): Promise<Buffer> {
    const framed = Buffer.concat([Buffer.from([request.length >> 8, request.length & 0xff]), request]);
    const whole = (received: Buffer) => received.length >= 2 && received.length >= 2 + received.readUInt16BE(0);
    return (await exchangeTcp(address, 53, framed, whole, timeoutMs)).subarray(2);
}

/** Asks the name server at `address` for the SOA record of `zone`, over UDP and, where the answer does not fit, TCP. */
async function askSoa(address: string, zone: string, timeoutMs: number): Promise<SoaAnswer> {
    const id = crypto.randomInt(0x10000);
    const query = encodeSoaQuery(zone, id);
    const answer = decodeSoaAnswer(await exchangeUdp(address, query, timeoutMs), id);
    return answer.truncated ? decodeSoaAnswer(await exchangeOverTcp(address, query, timeoutMs), id) : answer;
}

/**
 * Asks a name server for the SOA record of a zone and says whether it answered as one that
 * holds the zone. That is the question a client's resolver puts to it, and the one a
 * secondary asks to see whether the zone has changed -- an open port 53 answers neither.
 *
 * `address` has to be an IP address: a name server is told where to ask, not whom.
 */
export async function probeZone(address: string, zone: string, timeoutMs: number): Promise<ZoneProbe> {
    const started = Date.now();
    let answer: SoaAnswer;
    try {
        answer = await askSoa(address, zone, timeoutMs);
    } catch (err) {
        // A RangeError is the decoder's: something came back, and it was no answer to the question.
        return {
            ok: false,
            answered: false,
            detail: err instanceof RangeError ? `no DNS answer (${err.message})` : socketReason(err),
        };
    }
    if (answer.rcode !== 0) return { ok: false, answered: true, detail: answer.rcodeText ?? `response code ${answer.rcode}` };
    if (!answer.authoritative) return { ok: false, answered: true, detail: "not authoritative" };
    if (!answer.soa) return { ok: false, answered: true, detail: "no SOA record" };
    return {
        ok: true,
        answered: true,
        latencyMs: Date.now() - started,
        serial: answer.soa.serial,
        refresh: answer.soa.refresh,
        retry: answer.soa.retry,
    };
}

/**
 * Whether a domain controller's DNS server is there: it is asked for the SOA record of the
 * domain. Its own DNS server holds that zone, so an answer says the server works and
 * serves what the domain is found through.
 */
export async function probeDns(address: string, domain: string, timeoutMs: number): Promise<ProbeResult> {
    const { ok, detail, latencyMs } = await probeZone(address, domain, timeoutMs);
    if (ok) return { ok, latencyMs };
    // What the server said about the zone names the zone; that it could not be reached does not need to.
    const aboutTheZone = !!detail && !/^(timed out|connection refused|no route|connection closed)/.test(detail);
    return { ok, detail: aboutTheZone ? `${detail} for the zone ${domain}` : detail };
}
