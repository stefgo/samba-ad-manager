import http from "node:http";
import https from "node:https";

export interface ServerResponse {
    ok: boolean;
    status: number;
    text: string;
}

export interface ServerRequestOptions {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    /**
     * Accept a certificate that does not validate (self-signed, wrong host name). Passed per
     * request on purpose -- see serverRequest.
     */
    allowSelfSigned: boolean;
}

/**
 * An HTTP(S) request to the SADM server with the certificate check decided per call.
 *
 * This replaces `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"`, which the web UI used to
 * set before its first request to the server. That switch is process-wide and was never
 * turned back, so from then on every TLS connection of the agent accepted any certificate --
 * including the WebSocket that carries the auth token -- while before it none did. Whether a
 * self-signed server worked depended on whether someone had opened the status page since the
 * agent started.
 */
export function serverRequest(
    url: string,
    options: ServerRequestOptions,
): Promise<ServerResponse> {
    const { method = "GET", body, headers = {}, timeoutMs = 10000, allowSelfSigned } = options;

    return new Promise((resolve, reject) => {
        let target: URL;
        try {
            target = new URL(url);
        } catch {
            reject(new Error(`Invalid server URL: ${url}`));
            return;
        }

        const isHttps = target.protocol === "https:";
        const transport = isHttps ? https : http;

        const req = transport.request(
            target,
            {
                method,
                headers,
                ...(isHttps ? { rejectUnauthorized: !allowSelfSigned } : {}),
            },
            (res) => {
                let text = "";
                res.setEncoding("utf8");
                res.on("data", (chunk) => (text += chunk));
                res.on("end", () => {
                    const status = res.statusCode ?? 0;
                    resolve({ ok: status >= 200 && status < 300, status, text });
                });
            },
        );

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Timed out after ${timeoutMs} ms`));
        });
        req.on("error", reject);

        if (body) req.write(body);
        req.end();
    });
}

const CERTIFICATE_ERROR_CODES = new Set([
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** Whether an error is a failed certificate check, so the message can name the option. */
export function isCertificateError(err: unknown): boolean {
    const code = (err as { code?: unknown })?.code;
    return typeof code === "string" && CERTIFICATE_ERROR_CODES.has(code);
}
