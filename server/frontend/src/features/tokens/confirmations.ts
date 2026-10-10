import type { ConfirmOptions } from "@stefgo/react-ui-components";

/**
 * A token is single-use. Once used or expired it cannot register anything any more, so only
 * its record goes; an active one is what an agent may still be waiting to present.
 */
export function describeDeleteToken(active: boolean): ConfirmOptions {
    return {
        title: "Delete this registration token?",
        description: active
            ? "The token is still valid. An agent that has not registered with it yet can no longer do so; a new token has to be issued from the add-client wizard."
            : "The token is no longer valid, so only its record is deleted. Clients it registered are not affected.",
        confirmLabel: "Delete token",
        variant: "danger",
    };
}
