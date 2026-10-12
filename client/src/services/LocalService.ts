import fs from "fs/promises";
import path from "path";
import { AGENT_EVENTS, type DcLocalReport } from "@sadm/shared";
import { config } from "../core/Config.js";
import { Connection } from "../core/Connection.js";
import { logger } from "../core/logger.js";
import { gpoGuidOfFolder, gptIniVersion } from "./gptIni.js";
import { runSambaHelper, type SambaHelperResult } from "./SambaHelper.js";
import { readSupervisedProcesses } from "./supervisor.js";

/**
 * What only the domain controller itself can say: which of Samba's services run, what its
 * supervisor makes of its programs, how full the volume is and what the sysvol holds.
 *
 * Read on a timer and sent when it differs from what was last sent -- and once a minute
 * regardless, so the server can tell a domain controller where nothing changes from an agent
 * that has stopped reading.
 */

/** A report goes out at least this often, changed or not. */
const RESEND_AFTER_MS = 60_000;

type Paths = Pick<SambaHelperResult<"info">, "dnsDomain" | "privateDir" | "sysvolPath">;

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function readStorage(privateDir: string): Promise<NonNullable<DcLocalReport["storage"]>> {
    const stats = await fs.statfs(privateDir);
    // The directory database is sam.ldb and one file per partition beside it.
    let databaseBytes = 0;
    for (const file of ["sam.ldb", ...(await fs.readdir(path.join(privateDir, "sam.ldb.d")).catch(() => [])).map((name) => path.join("sam.ldb.d", name))]) {
        databaseBytes += (await fs.stat(path.join(privateDir, file)).catch(() => null))?.size ?? 0;
    }
    return {
        path: privateDir,
        totalBytes: stats.blocks * stats.bsize,
        // What Samba can still write: the blocks a process without privileges may take.
        freeBytes: stats.bavail * stats.bsize,
        databaseBytes,
    };
}

async function readSysvol(sysvolPath: string, dnsDomain: string): Promise<NonNullable<DcLocalReport["sysvol"]>> {
    const policies = path.join(sysvolPath, dnsDomain.toLowerCase(), "Policies");
    const gpos: NonNullable<DcLocalReport["sysvol"]>["gpos"] = [];
    // No Policies folder is an answer, not a failure to read: a domain controller that
    // joined and was never given the sysvol has none, and holds no policy at all.
    const entries = await fs.readdir(policies, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return [];
        throw err;
    });
    for (const entry of entries) {
        const guid = entry.isDirectory() ? gpoGuidOfFolder(entry.name) : null;
        if (!guid) continue;
        const folder = path.join(policies, entry.name);
        // Windows writes GPT.INI, and nothing promises the case.
        const file = (await fs.readdir(folder).catch(() => [])).find((name) => name.toLowerCase() === "gpt.ini");
        const text = file ? await fs.readFile(path.join(folder, file), "utf8").catch(() => null) : null;
        gpos.push({ guid, version: text === null ? null : gptIniVersion(text) });
    }
    return { path: policies, gpos: gpos.sort((a, b) => a.guid.localeCompare(b.guid)) };
}

export class LocalService {
    private static paths: Paths | null = null;
    private static timer: NodeJS.Timeout | null = null;
    private static reading: Promise<void> | null = null;
    private static lastSent: { body: string; at: number } | null = null;
    private static last: DcLocalReport | null = null;

    /** Where Samba keeps what is read here, as the helper found it at startup. */
    static configure(paths: Paths): void {
        this.paths = paths;
    }

    /** The last report, for the status page. */
    static lastReport(): DcLocalReport | null {
        return this.last;
    }

    static start(): void {
        Connection.onServerMessage(AGENT_EVENTS.REQUEST_REPORT, () => void this.refresh(true));
        // A server that has just accepted this agent gets the current state at once.
        Connection.onConnected(() => void this.refresh(true));
        this.timer = setInterval(() => void this.refresh(false), config.report.interval * 1000);
        void this.refresh(false);
    }

    static stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    /** One reading. A part that cannot be read is left out and named in `errors`. */
    private static async collect(): Promise<DcLocalReport> {
        const paths = this.paths;
        const errors: DcLocalReport["errors"] = [];
        const part = async <T>(source: string, read: () => Promise<T>): Promise<T | undefined> => {
            try {
                return await read();
            } catch (err) {
                errors.push({ source, message: reason(err) });
                return undefined;
            }
        };

        const socket = config.samba.supervisorSocket;
        const [services, processes, storage, sysvol] = await Promise.all([
            part("services", () => runSambaHelper("services")),
            // No socket configured: a domain controller that is not run by supervisord. Nothing to read, and nothing missing.
            socket ? part("processes", () => readSupervisedProcesses(socket)) : undefined,
            paths ? part("storage", () => readStorage(paths.privateDir)) : undefined,
            paths?.sysvolPath ? part("sysvol", () => readSysvol(paths.sysvolPath!, paths.dnsDomain)) : undefined,
        ]);
        return { collectedAt: new Date().toISOString(), services, processes, storage, sysvol, errors };
    }

    /**
     * Reads, and sends what was read when it differs from what was last sent, when that is a
     * minute ago, or when `force` says the server asked. A reading that is already under way
     * is the one a second caller gets.
     */
    static refresh(force: boolean): Promise<void> {
        if (this.reading) return this.reading;
        const reading = (async () => {
            try {
                const report = await this.collect();
                this.last = report;
                // The time of the reading is the one thing that differs between two readings of the same state.
                const body = JSON.stringify({ ...report, collectedAt: undefined });
                const now = Date.now();
                const unchanged = this.lastSent?.body === body && now - this.lastSent.at < RESEND_AFTER_MS;
                if (!force && unchanged) return;
                if (Connection.send(AGENT_EVENTS.LOCAL_REPORT, report)) this.lastSent = { body, at: now };
            } catch (err) {
                logger.warn({ err }, "Could not read the local state of this domain controller");
            }
        })();
        this.reading = reading;
        void reading.finally(() => {
            if (this.reading === reading) this.reading = null;
        });
        return reading;
    }
}
