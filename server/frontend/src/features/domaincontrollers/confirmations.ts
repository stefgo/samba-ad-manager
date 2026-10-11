import type { DomainController } from "@sadm/shared";
import type { ConfirmOptions } from "@stefgo/react-ui-components";

/**
 * A new token replaces the one the domain controller's script holds. Until the script has
 * the new one, its reports are refused -- the part an operator has to act on, and so the
 * part spelled out.
 */
export function describeReplaceReportToken(dc: DomainController): ConfirmOptions {
    return {
        title: `Issue a new token for ${dc.name}?`,
        description:
            "The token its database check is reported with now stops working at once. The script on the domain controller has to be given the new one, or its reports are refused.",
        confirmLabel: "Issue new token",
        variant: "danger",
    };
}

/** Taking the token away ends the expectation, and with it the finding about a report that is late. */
export function describeRevokeReportToken(dc: DomainController): ConfirmOptions {
    return {
        title: `Stop expecting a database check from ${dc.name}?`,
        description:
            "Its token stops working, the last reported check is forgotten, and a missing report is no longer a finding. The script on the domain controller keeps running until it is removed there; its reports are refused.",
        confirmLabel: "Stop expecting reports",
        variant: "danger",
    };
}
