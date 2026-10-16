import net from "net";
import tls, { type PeerCertificate } from "node:tls";
import type { TlsCertificate } from "@sadm/shared";
import { certificateOf, untrustedReason } from "./certificate.js";
import { startTlsRequest, readStartTlsAnswer } from "./startTlsMessage.js";
import { socketReason } from "./tcp.js";

/** What a TLS handshake found: the certificate, and whether it is good for the host. */
export type TlsProbe =
    | { ok: true; trusted: boolean; detail: string | null; certificate: TlsCertificate | null; latencyMs: number }
    /** No handshake took place: the port does not answer, or StartTLS was refused. */
    | { ok: false; detail: string };

export interface TlsProbeOptions {
    /** The name the certificate is checked against, where it is not `host`; also sent as SNI. */
    servername?: string | null;
    /** Ask for StartTLS first, as on LDAP's port 389. */
    startTls?: boolean;
    /** The CAs a certificate may chain to; the public ones Node ships with without. */
    ca?: (string | Buffer)[];
    timeoutMs: number;
}

/**
 * One TLS handshake, for the certificate and nothing else: nothing is sent over it, and it
 * is closed once the certificate is read. It is never refused on the certificate's account
 * -- whether that is trusted is what it reports.
 */
export function probeTls(host: string, port: number, options: TlsProbeOptions): Promise<TlsProbe> {
    return new Promise((resolve) => {
        const started = Date.now();
        const name = options.servername || host;
        const sockets: net.Socket[] = [];
        let settled = false;
        const done = (result: TlsProbe) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            // The TLS socket before the plain one it runs on: the other way round, Node 22
            // dies of a segmentation fault the next time it opens a TLS connection.
            for (const socket of sockets.reverse()) socket.destroy();
            resolve(result);
        };
        const timer = setTimeout(() => done({ ok: false, detail: "timed out" }), options.timeoutMs);

        const handshake = (plain?: net.Socket) => {
            const secure = tls.connect({
                ...(plain ? { socket: plain } : { host, port }),
                // An address is no name for SNI; the check then looks for it among the certificate's addresses.
                ...(net.isIP(name) ? {} : { servername: name }),
                ca: options.ca,
                rejectUnauthorized: false,
                checkServerIdentity: (_host, cert) => tls.checkServerIdentity(name, cert),
            });
            sockets.push(secure);
            secure.once("secureConnect", () => {
                const peer: PeerCertificate = secure.getPeerCertificate();
                const certificate = peer && Object.keys(peer).length > 0 ? certificateOf(peer) : null;
                const reason = secure.authorizationError ? String(secure.authorizationError) : null;
                done({
                    ok: true,
                    trusted: secure.authorized,
                    detail: secure.authorized || !reason ? null : untrustedReason(reason, certificate),
                    certificate,
                    latencyMs: Date.now() - started,
                });
            });
            secure.once("error", (err) => done({ ok: false, detail: socketReason(err) }));
        };

        if (!options.startTls) {
            handshake();
            return;
        }
        const plain = net.connect({ host, port });
        sockets.push(plain);
        let received = Buffer.alloc(0);
        const onData = (chunk: Buffer) => {
            received = Buffer.concat([received, chunk]);
            const answer = readStartTlsAnswer(received);
            if (!answer.complete) return;
            plain.off("data", onData);
            if (answer.ok) handshake(plain);
            else done({ ok: false, detail: answer.detail });
        };
        plain.once("connect", () => plain.write(startTlsRequest()));
        plain.on("data", onData);
        plain.once("error", (err) => done({ ok: false, detail: socketReason(err) }));
        plain.once("close", () => done({ ok: false, detail: "connection closed" }));
    });
}
