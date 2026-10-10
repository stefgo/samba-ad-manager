import type { ConfirmOptions } from "@stefgo/react-ui-components";
import { plural } from "../../utils";

/**
 * "Delete all" empties the whole history on the server -- not only what the level filter and
 * the search leave on screen, and not only for the operator who asks.
 */
export function describeDeleteAllActivity(count: number): ConfirmOptions {
    return {
        title: `Delete all ${plural(count, "event")}?`,
        description: "The whole activity history is deleted for every user, including entries the current filter hides. This cannot be undone.",
        confirmLabel: "Delete all",
        variant: "danger",
    };
}
