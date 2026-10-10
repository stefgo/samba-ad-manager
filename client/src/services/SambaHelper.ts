import { z } from "zod";
import { config } from "../core/Config.js";
import { DockerService } from "./DockerService.js";
import { SAMBA_HELPER_SOURCE, type SambaHelperAction } from "./sambaHelperScript.js";

/** The one line the helper writes: its result, or why there is none. */
const HelperAnswerSchema = z.union([
    z.object({ ok: z.literal(true), data: z.unknown() }),
    z.object({ ok: z.literal(false), error: z.string() }),
]);

const NeighbourSchema = z.object({
    namingContext: z.string(),
    partnerDn: z.string(),
    lastAttempt: z.string().nullable(),
    lastSuccess: z.string().nullable(),
    consecutiveFailures: z.number().int(),
    resultCode: z.number().int(),
    resultText: z.string().nullable(),
});

/** What each action answers. The helper is this agent's own, and still not taken on trust. */
const RESULT_SCHEMAS = {
    replication: z.object({ inbound: z.array(NeighbourSchema), outbound: z.array(NeighbourSchema) }),
    processes: z.array(z.object({ name: z.string(), pids: z.array(z.number().int()) })),
    dbcheck: z.object({ errors: z.number().int(), durationMs: z.number() }),
} satisfies Record<SambaHelperAction, z.ZodType>;

export type SambaHelperResult<A extends SambaHelperAction> = z.infer<(typeof RESULT_SCHEMAS)[A]>;

const TIMEOUT_MS: Record<SambaHelperAction, number> = {
    replication: 30_000,
    processes: 15_000,
    // Walks every object of the domain. Minutes on a large directory.
    dbcheck: 9 * 60_000,
};

/**
 * Runs one action of the helper script (`sambaHelperScript.ts`) inside the Samba container and
 * returns its checked result. The action is one of a fixed list; nothing else is passed in.
 */
export async function runSambaHelper<A extends SambaHelperAction>(action: A): Promise<SambaHelperResult<A>> {
    const { exitCode, stdout, stderr } = await DockerService.exec(
        [config.samba.python, "-c", SAMBA_HELPER_SOURCE, action],
        { timeoutMs: TIMEOUT_MS[action] },
    );

    // The last line, in case a module wrote to the real stdout behind the helper's back.
    const line = stdout.trim().split("\n").pop() ?? "";
    let json: unknown;
    try {
        json = JSON.parse(line);
    } catch {
        const reason = stderr.trim().split("\n").pop() || `exit code ${exitCode}`;
        throw new Error(`The Samba helper gave no answer (${reason})`);
    }
    const answer = HelperAnswerSchema.safeParse(json);
    if (!answer.success) throw new Error("The Samba helper answered in a form this agent does not know");
    if (!answer.data.ok) throw new Error(answer.data.error);

    const result = RESULT_SCHEMAS[action].safeParse(answer.data.data);
    if (!result.success) {
        throw new Error(`The Samba helper's ${action} result has an unexpected shape`);
    }
    return result.data as SambaHelperResult<A>;
}
