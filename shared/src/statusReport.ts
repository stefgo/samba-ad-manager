import { z } from "zod";

/**
 * What `GET /api/v1/status` answers: the verdict and the findings the dashboard shows, for a
 * reader that is not a browser -- Home Assistant, a monitoring system, a script.
 *
 * The same contract in every stefgo manager (sadm, kasm, dpm, dim, pbcm), so one reader can
 * ask all of them. `summary` is the one part that differs: each application's key figures,
 * the numbers its dashboard cards show.
 */

/** The overall verdict, as the dashboard's first card says it. */
export const OverallStatusSchema = z.enum(["healthy", "degraded", "critical", "unknown"]);
export type OverallStatus = z.infer<typeof OverallStatusSchema>;

/** One line of the dashboard's "Needs attention" list. */
export const StatusFindingSchema = z.object({
    /** Stays the same from one evaluation to the next while the finding lasts; never derived from `text`. */
    id: z.string(),
    /** What kind of finding it is; each application has its own list. */
    type: z.string(),
    severity: z.enum(["error", "warning"]),
    /** The line exactly as the dashboard writes it. */
    text: z.string(),
    /** Since when the finding stands, where that is known (ISO 8601). */
    since: z.string().nullable().optional(),
});
export type StatusFinding = z.infer<typeof StatusFindingSchema>;

export const StatusReportSchema = z.object({
    /** Which application answers: `sadm`, `kasm`, `dpm`, `dim` or `pbcm`. */
    app: z.string(),
    /** The version of the server that answers; null where the build did not say. */
    version: z.string().nullable(),
    status: OverallStatusSchema,
    /** When the server put this answer together (ISO 8601). */
    checkedAt: z.string(),
    /** How many of `findings` are errors and how many warnings. */
    counts: z.object({ error: z.number().int(), warning: z.number().int() }),
    /** The key figures of the dashboard's cards; the shape is the application's own. */
    summary: z.record(z.string(), z.unknown()),
    /** In the dashboard's order. */
    findings: z.array(StatusFindingSchema),
});
export type StatusReport = z.infer<typeof StatusReportSchema>;

/** How many of the findings are errors and how many warnings. */
export function countFindings(findings: readonly Pick<StatusFinding, "severity">[]): StatusReport["counts"] {
    let error = 0;
    let warning = 0;
    for (const finding of findings) {
        if (finding.severity === "error") error++;
        else warning++;
    }
    return { error, warning };
}
