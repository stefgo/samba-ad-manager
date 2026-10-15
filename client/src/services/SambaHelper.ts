import { execFile } from "child_process";
import { z } from "zod";
import { config } from "../core/Config.js";
import { SAMBA_HELPER_SOURCE, type SambaHelperAction } from "./sambaHelperScript.js";

/** The one line the helper writes: its result, or why there is none. */
const HelperAnswerSchema = z.union([
    z.object({ ok: z.literal(true), data: z.unknown() }),
    z.object({ ok: z.literal(false), error: z.string() }),
]);

/** What each action answers. The helper is this agent's own, and still not taken on trust. */
const RESULT_SCHEMAS = {
    info: z.object({
        dcId: z.string().min(1),
        dnsDomain: z.string().min(1),
        privateDir: z.string().min(1),
        sysvolPath: z.string().nullable(),
    }),
    services: z.object({
        configured: z.array(z.string()),
        running: z.array(z.object({ name: z.string(), pids: z.array(z.number().int()) })),
    }),
    dbcheck: z.object({ errors: z.number().int(), durationMs: z.number() }),
    "dbcheck-fix": z.object({ errors: z.number().int(), durationMs: z.number() }),
    replicate: z.object({
        links: z.array(
            z.object({
                partner: z.string(),
                partnerAddress: z.string().nullable(),
                namingContext: z.string(),
                error: z.string().nullable(),
            }),
        ),
        durationMs: z.number(),
    }),
} satisfies Record<SambaHelperAction, z.ZodType>;

export type SambaHelperResult<A extends SambaHelperAction> = z.infer<(typeof RESULT_SCHEMAS)[A]>;

const TIMEOUT_MS: Record<SambaHelperAction, number> = {
    info: 30_000,
    services: 15_000,
    // Walks every object of every partition. Minutes on a large directory.
    dbcheck: 30 * 60_000,
    // The same walk, inside one transaction. A fix killed by the timeout writes nothing.
    "dbcheck-fix": 30 * 60_000,
    // One link after the other, each until it has pulled what its partner has.
    replicate: 10 * 60_000,
};

/**
 * Runs one action of the helper script (`sambaHelperScript.ts`) with Samba's own Python and
 * returns its checked result. The action is one of a fixed list; nothing else is passed in.
 */
export function runSambaHelper<A extends SambaHelperAction>(action: A): Promise<SambaHelperResult<A>> {
    return new Promise((resolve, reject) => {
        execFile(
            config.samba.python,
            ["-c", SAMBA_HELPER_SOURCE, action],
            { timeout: TIMEOUT_MS[action], maxBuffer: 16 * 1024 * 1024 },
            (err, stdout, stderr) => {
                // The last line, in case a module wrote to the real stdout behind the helper's back.
                const line = stdout.trim().split("\n").pop() ?? "";
                let json: unknown;
                try {
                    json = JSON.parse(line);
                } catch {
                    const reason = stderr.trim().split("\n").pop() || (err ? err.message : "no output");
                    reject(new Error(`The Samba helper gave no answer (${reason})`));
                    return;
                }
                const answer = HelperAnswerSchema.safeParse(json);
                if (!answer.success) {
                    reject(new Error("The Samba helper answered in a form this agent does not know"));
                    return;
                }
                if (!answer.data.ok) {
                    reject(new Error(answer.data.error));
                    return;
                }
                const result = RESULT_SCHEMAS[action].safeParse(answer.data.data);
                if (!result.success) {
                    reject(new Error(`The Samba helper's ${action} result has an unexpected shape`));
                    return;
                }
                resolve(result.data as SambaHelperResult<A>);
            },
        );
    });
}
