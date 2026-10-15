import type { ActivityLevel, ReplicationSyncReport } from "@sadm/shared";

/** How a replication from every inbound partner is recorded: its level, and `data` without the domain controller's name. */
export interface ReplicationSyncActivity {
    level: ActivityLevel;
    data: {
        links: number;
        failed: number;
        failures: { partner: string; namingContext: string; error: string }[];
        error?: string;
    };
}

/** The detail of an event carries this much, as an agent's own error does. */
const MAX_ERROR = 2000;

/**
 * Turns what an agent reported of a replication into its activity: info when every link
 * replicated, warning when some failed, error when all did or none could be asked. No link
 * at all is info for a domain controller that has no partner -- the only one there is -- and
 * a warning for one that should have. A partner is named
 * as the domain controller list names it -- `nameOf` gets the GUID of its NTDS settings in
 * lower case, as the list keeps it -- and by its address where the list does not know it.
 * `error` is the event's detail: why nothing was asked, or which links failed and why.
 */
export function replicationSyncActivity(
    report: ReplicationSyncReport,
    nameOf: (partnerId: string) => string | null,
    hasPartners = false,
): ReplicationSyncActivity {
    const failures = report.links.flatMap((link) =>
        link.error
            ? [{ partner: nameOf(link.partner.toLowerCase()) ?? link.partnerAddress ?? link.partner, namingContext: link.namingContext, error: link.error }]
            : [],
    );
    const error =
        report.error ?? (failures.length > 0 ? failures.map((f) => `from ${f.partner}, ${f.namingContext}: ${f.error}`).join("; ") : null);
    const links = report.links.length;
    const level: ActivityLevel = report.error
        ? "error"
        : links === 0
          ? hasPartners
              ? "warning"
              : "info"
          : failures.length === links
            ? "error"
            : failures.length > 0
              ? "warning"
              : "info";
    return {
        level,
        data: {
            links: report.links.length,
            failed: failures.length,
            failures,
            ...(error ? { error: error.slice(0, MAX_ERROR) } : {}),
        },
    };
}
