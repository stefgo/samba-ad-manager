import { WS_EVENTS, parseLdapServiceUrl, parseServerDn, type ServiceUrlHealth } from "@sadm/shared";
import { logger } from "../core/logger.js";
import { DcConnections, hostInUrl } from "../dc/DcConnections.js";
import { attr, DcLdap } from "../dc/DcLdap.js";
import { socketReason } from "../dc/probes/tcp.js";
import { probeTls } from "../dc/probes/tls.js";
import { DashboardHub } from "./DashboardHub.js";

/** How long a URL may take to answer one question. */
const PROBE_TIMEOUT_MS = 4000;

/**
 * The names applications reach the directory under (`directory.serviceUrls`): asks each of
 * them, keeps the answers and tells the dashboards.
 *
 * Kept in memory only. Nothing about a URL depends on what it said before, and the first
 * round after a start asks them again.
 */
export class ServiceUrlHealthService {
    private static listeners: (() => void)[] = [];
    private static last: ServiceUrlHealth[] = [];

    static onUpdate(listener: () => void): void {
        this.listeners.push(listener);
    }

    /** Every URL as it was last asked. */
    static getAll(): ServiceUrlHealth[] {
        return this.last;
    }

    /** Asks every URL of `urls`, all at once. */
    static async measure(urls: readonly string[]): Promise<void> {
        const measured = await Promise.all(urls.flatMap((url) => (parseLdapServiceUrl(url) ? [this.ask(url)] : [])));
        this.last = measured;
        DashboardHub.broadcast({ type: WS_EVENTS.SERVICE_URLS_UPDATE, payload: measured });
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                logger.warn({ err }, "A listener failed on a change of the central URLs' health");
            }
        }
    }

    /**
     * Reads the rootDSE through the URL, without a bind, and has a TLS handshake look at the
     * certificate -- after StartTLS for an `ldap://` URL. Apart, because the first must not
     * fail on the certificate: which domain controller answers is worth knowing either way.
     */
    private static async ask(url: string): Promise<ServiceUrlHealth> {
        const { scheme, host, port } = parseLdapServiceUrl(url)!;
        const collectedAt = new Date().toISOString();

        // What the directory tells anyone: no password goes along, so the certificate need not hold for this.
        const ldap = new DcLdap({ url: `${scheme}://${hostInUrl(host)}:${port}`, bind: null, allowSelfSigned: true, timeoutMs: PROBE_TIMEOUT_MS });
        const started = Date.now();
        let read: Pick<ServiceUrlHealth, "ok" | "detail" | "latencyMs" | "answeredBy">;
        try {
            const root = await ldap.read("", ["serverName", "dnsHostName"]);
            if (!root) throw new Error("the directory returned no rootDSE");
            read = {
                ok: true,
                detail: null,
                latencyMs: Date.now() - started,
                answeredBy: parseServerDn(attr(root, "serverName") ?? "")?.name ?? attr(root, "dnsHostName"),
            };
        } catch (err) {
            read = { ok: false, detail: socketReason(err), latencyMs: null, answeredBy: null };
        } finally {
            await ldap.reset();
        }

        const probe = await probeTls(host, port, { startTls: scheme === "ldap", ca: DcConnections.trustedCas(), timeoutMs: PROBE_TIMEOUT_MS });
        // Where nothing answers at all, that is the finding; a failed handshake would only repeat it.
        const tls: ServiceUrlHealth["tls"] = probe.ok
            ? { ok: probe.trusted, detail: probe.detail, certificate: probe.certificate }
            : read.ok && scheme === "ldap"
              ? { ok: false, detail: probe.detail }
              : null;
        return { url, scheme, host, port, collectedAt, ...read, tls };
    }
}
