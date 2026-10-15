import { AGENT_CAPABILITIES, type DcAgent, type DcDbcheck } from "@sadm/shared";

/** Whether "Fix errors" is offered, and why it cannot be clicked where it is offered and cannot. */
export type DbcheckFixOffer = { offered: false } | { offered: true; disabledReason: string | null };

/**
 * When the errors of a database check can be fixed from here. Offered only for a check
 * that counted errors, and not by a server that may change nothing. Where the agent stands
 * in the way -- its operator did not allow it, or it is away -- it is offered and says why
 * not, so that it can be found.
 *
 * `readOnly` is null while it is not known: the server then decides, and says so.
 */
export function dbcheckFixOffer(
    agent: Pick<DcAgent, "capabilities" | "connected">,
    dbcheck: Pick<DcDbcheck, "errors"> | null,
    readOnly: boolean | null,
): DbcheckFixOffer {
    if (!dbcheck || !dbcheck.errors || readOnly === true) return { offered: false };
    if (!agent.capabilities.includes(AGENT_CAPABILITIES.DBCHECK_FIX)) {
        return { offered: true, disabledReason: "The agent is not allowed to fix its database: report.dbcheckAllowFix in its config.yaml" };
    }
    if (!agent.connected) return { offered: true, disabledReason: "The agent is not connected" };
    return { offered: true, disabledReason: null };
}

const errorsText = (count: number) => `${count} ${count === 1 ? "error" : "errors"}`;

/** How the last fix went, in a few words; the time stands beside it. */
export function lastFixText(fix: NonNullable<DcDbcheck["fix"]>): string {
    if (fix.errorsFound === null) return `Failed, nothing was changed${fix.error ? `: ${fix.error}` : ""}`;
    return fix.errorsFound === 0 ? "Found nothing to fix" : `Went at ${errorsText(fix.errorsFound)}`;
}
