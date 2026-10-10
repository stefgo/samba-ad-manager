import type { ConfirmOptions } from "@stefgo/react-ui-components";

/** Deleting a webhook stops its deliveries; events already sent are not affected. */
export function describeDeleteWebhook(name: string): ConfirmOptions {
    return {
        title: `Delete the webhook "${name}"?`,
        description: "No further events are sent to it. Deliveries still under way may finish.",
        confirmLabel: "Delete webhook",
        variant: "danger",
    };
}
