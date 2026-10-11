import { Resolver } from "dns/promises";
import type { ProbeResult } from "./tcp.js";

/**
 * Asks the domain controller's DNS server for the SOA record of the domain. Samba's own DNS
 * server holds that zone, so an answer says the server is there and serves what the domain
 * is found through -- which an open port 53 does not.
 *
 * `address` has to be an IP address: a resolver is told where to ask, not whom.
 */
export async function probeDns(address: string, domain: string, timeoutMs: number): Promise<ProbeResult> {
    const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
    const started = Date.now();
    try {
        resolver.setServers([address]);
        await resolver.resolveSoa(domain);
        return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
        const code = (err as NodeJS.ErrnoException | null)?.code;
        switch (code) {
            case "ETIMEOUT":
                return { ok: false, detail: "timed out" };
            case "ECONNREFUSED":
                return { ok: false, detail: "connection refused" };
            case "ENOTFOUND":
            case "ENODATA":
                return { ok: false, detail: `does not know the zone ${domain}` };
            case "ESERVFAIL":
                return { ok: false, detail: `fails for the zone ${domain} (SERVFAIL)` };
            case "EREFUSED":
                return { ok: false, detail: `refuses the zone ${domain}` };
            default:
                return { ok: false, detail: err instanceof Error ? err.message : String(code ?? err) };
        }
    } finally {
        resolver.cancel();
    }
}
