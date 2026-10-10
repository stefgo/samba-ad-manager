import type { ConfirmOptions } from "@stefgo/react-ui-components";

/** What leaving an editor keeps, per editor. The question and its buttons are the same everywhere. */
const DISCARD_CONSEQUENCE = {
    client: "The client has not been saved. Leaving now keeps it as it was.",
    newClient: "The client has not been added. Leaving now discards what you entered.",
    webhook: "The webhook has not been saved. Leaving now keeps it as it was.",
    settings: "Some settings have not been saved. Leaving now keeps them as they were.",
} as const;

export type DiscardEditor = keyof typeof DISCARD_CONSEQUENCE;

/** Asked when an editor with unsaved changes is left, whichever way (see `useUnsavedChangesGuard`). */
export function describeDiscardChanges(editor: DiscardEditor): ConfirmOptions {
    return {
        title: "Discard your changes?",
        description: DISCARD_CONSEQUENCE[editor],
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        variant: "danger",
    };
}
