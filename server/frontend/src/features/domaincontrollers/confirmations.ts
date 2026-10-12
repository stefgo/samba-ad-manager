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
