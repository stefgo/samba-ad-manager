import net from "net";

/** What a probe found: whether the service answered, and why not or how fast. */
export interface ProbeResult {
    ok: boolean;
    detail?: string;
    latencyMs?: number;
}

/** How a socket error reads to an operator. */
export function socketReason(err: unknown): string {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    switch (code) {
        case "ECONNREFUSED":
            return "connection refused";
        case "EHOSTUNREACH":
        case "ENETUNREACH":
            return "no route to the host";
        case "ETIMEDOUT":
            return "timed out";
        case "ECONNRESET":
        case "EPIPE":
            return "connection closed";
        case "ENOTFOUND":
        case "EAI_AGAIN":
            return "the name does not resolve";
        default: {
            const message = err instanceof Error && err.message ? err.message : String(code ?? err);
            // Every library words its own timeout; a reader should meet one wording.
            return /time(d)?[ -]?out/i.test(message) ? "timed out" : message;
        }
    }
}

/**
 * Whether a port accepts a connection. All this server can ask of a service whose protocol
 * it does not speak -- and it says less than it seems to: a process that hangs keeps its
 * port open, so this notices a service that is gone, not one that no longer answers.
 */
export function probeTcp(host: string, port: number, timeoutMs: number): Promise<ProbeResult> {
    return new Promise((resolve) => {
        const started = Date.now();
        const socket = net.connect({ host, port });
        const done = (result: ProbeResult) => {
            socket.destroy();
            resolve(result);
        };
        socket.setTimeout(timeoutMs, () => done({ ok: false, detail: "timed out" }));
        socket.once("connect", () => done({ ok: true, latencyMs: Date.now() - started }));
        socket.once("error", (err) => done({ ok: false, detail: socketReason(err) }));
    });
}

/**
 * Sends one request over TCP and resolves with everything the peer answers until `complete`
 * says the answer is whole. For the protocols that are a request and a reply.
 */
export function exchangeTcp(
    host: string,
    port: number,
    request: Uint8Array,
    complete: (received: Buffer) => boolean,
    timeoutMs: number,
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host, port });
        let received = Buffer.alloc(0);
        const fail = (err: unknown) => {
            socket.destroy();
            reject(err);
        };
        socket.setTimeout(timeoutMs, () => fail(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })));
        socket.once("connect", () => socket.write(request));
        socket.on("data", (chunk) => {
            received = Buffer.concat([received, chunk]);
            if (complete(received)) {
                socket.destroy();
                resolve(received);
            }
        });
        socket.once("error", fail);
        socket.once("close", () => fail(Object.assign(new Error("connection closed"), { code: "ECONNRESET" })));
    });
}
