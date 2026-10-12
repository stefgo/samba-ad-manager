import http from "http";
import { z } from "zod";
import { parseXmlRpcResponse, xmlRpcCall } from "./xmlRpc.js";

/**
 * The programs supervisord runs in this container -- Samba itself, BIND -- asked over its
 * XML-RPC interface on a Unix socket. `supervisorctl status` is the same question, answered
 * as a table.
 */

/** One entry of `supervisor.getAllProcessInfo`, as far as it is read. */
const ProcessInfoSchema = z.looseObject({
    name: z.string(),
    statename: z.string(),
    pid: z.number().int().optional(),
    /** Unix time of the last start; 0 for a program that never started. */
    start: z.number().optional(),
    exitstatus: z.number().int().optional(),
});

/** A type, not an interface: it goes into a report whose schema is loose, and only a type alias has the index signature that takes. */
export type SupervisedProcess = {
    name: string;
    /** supervisord's own word: `RUNNING`, `BACKOFF`, `FATAL`, `EXITED`. */
    state: string;
    pid: number | null;
    startedAt: string | null;
    exitStatus: number | null;
    recentStarts: number;
};

/** What a process info says, in the words of the report. */
export function toSupervisedProcess(raw: unknown): Omit<SupervisedProcess, "recentStarts"> & { startSeconds: number } {
    const info = ProcessInfoSchema.parse(raw);
    const startSeconds = info.start && info.start > 0 ? info.start : 0;
    return {
        name: info.name,
        state: info.statename,
        pid: info.pid && info.pid > 0 ? info.pid : null,
        startedAt: startSeconds > 0 ? new Date(startSeconds * 1000).toISOString() : null,
        // supervisord reports the last exit status of a program even while it runs again.
        exitStatus: info.statename === "RUNNING" || info.statename === "STARTING" ? null : (info.exitstatus ?? null),
        startSeconds,
    };
}

/** How far back a start counts towards "keeps restarting". */
export const RECENT_STARTS_WINDOW_MS = 60 * 60_000;

/**
 * Remembers the starts of each program this agent has seen, and says how many of them lie
 * within the last hour. supervisord itself counts none: it only knows when a program last
 * started, so a program that is restarted every two minutes looks fine at every look.
 *
 * Pure: takes what was seen before and returns what is seen now. What it knows starts with
 * this agent; a restart of the agent forgets it.
 */
export function trackStarts(
    seen: ReadonlyMap<string, readonly number[]>,
    processes: readonly { name: string; startSeconds: number }[],
    now: number,
): Map<string, number[]> {
    const next = new Map<string, number[]>();
    for (const { name, startSeconds } of processes) {
        const starts = (seen.get(name) ?? []).filter((start) => now - start * 1000 < RECENT_STARTS_WINDOW_MS);
        if (startSeconds > 0 && now - startSeconds * 1000 < RECENT_STARTS_WINDOW_MS && !starts.includes(startSeconds)) {
            starts.push(startSeconds);
        }
        next.set(name, starts);
    }
    return next;
}

function call(socketPath: string, method: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const body = xmlRpcCall(method);
        const request = http.request(
            {
                socketPath,
                path: "/RPC2",
                method: "POST",
                headers: { "Content-Type": "text/xml", "Content-Length": Buffer.byteLength(body) },
            },
            (response) => {
                let text = "";
                response.setEncoding("utf8");
                response.on("data", (chunk) => (text += chunk));
                response.on("end", () => {
                    if (response.statusCode !== 200) reject(new Error(`supervisord answered HTTP ${response.statusCode}`));
                    else resolve(text);
                });
            },
        );
        request.setTimeout(timeoutMs, () => request.destroy(new Error(`supervisord did not answer within ${timeoutMs} ms`)));
        request.on("error", reject);
        request.end(body);
    });
}

let seenStarts: ReadonlyMap<string, readonly number[]> = new Map();

/** Every program of the supervisord behind `socketPath`. */
export async function readSupervisedProcesses(socketPath: string): Promise<SupervisedProcess[]> {
    const answer = parseXmlRpcResponse(await call(socketPath, "supervisor.getAllProcessInfo", 5000));
    if (!Array.isArray(answer)) throw new Error("supervisord answered with something that is no list of processes");
    const processes = answer.map(toSupervisedProcess);
    seenStarts = trackStarts(seenStarts, processes, Date.now());
    return processes
        .map(({ startSeconds: _startSeconds, ...process }) => ({ ...process, recentStarts: seenStarts.get(process.name)?.length ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
