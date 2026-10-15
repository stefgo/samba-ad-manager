import type { DomainController } from "@sadm/shared";
import type { ConfirmOptions } from "@stefgo/react-ui-components";

/**
 * Removing an agent here does not stop it there: it keeps running in the domain controller's
 * container with an identity this server no longer knows. That is the part an operator has
 * to act on, and so the part spelled out.
 */
export function describeRemoveAgent(dc: DomainController): ConfirmOptions {
    return {
        title: `Remove the agent of ${dc.name}?`,
        description:
            "What it reported is forgotten: the services, the storage, the sysvol and the last database check. The agent itself keeps running on the domain controller and is refused from now on; to register it again, delete identity.json in its data directory and restart it.",
        confirmLabel: "Remove agent",
        variant: "danger",
    };
}

/**
 * Fixing a domain controller's database writes to it, as root, in one transaction that
 * makes every other write wait. What that means for the domain controller, and that a
 * backup comes first, is what is said.
 */
export function describeFixDbcheck(dc: DomainController, errors: number): ConfirmOptions {
    return {
        title: `Fix the database of ${dc.name}?`,
        description: `The agent fixes the ${errors === 1 ? "error" : `${errors} errors`} of the last check as samba-tool dbcheck --cross-ncs --fix --yes does: everything the check finds, in one transaction that every other write to this domain controller's database waits for. It takes about as long as the check. A fix that fails changes nothing. Have a backup of the domain controller first. A check follows, and its result shows here.`,
        confirmLabel: "Fix errors",
        variant: "danger",
    };
}
