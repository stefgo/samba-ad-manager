import { Client, UpdateClient, UpdateClientSchema } from "@sadm/shared";
import { X } from "lucide-react";
import { ActionButton } from "@stefgo/react-ui-components";
import { useEntityForm } from "../../../hooks/useEntityForm";
import { useUnsavedChangesGuard } from "../../../hooks/useUnsavedChangesGuard";
import { useClient } from "../../../queries/clients";
import { ClientIdentityCard } from "./ClientIdentityCard";
import {
    clientDraftFrom,
    clientFieldOf,
    clientInputFrom,
    clientRules,
    isOutbound,
    significantClientDraft,
    storedClientDraft,
    type ClientDraft,
} from "../lib/clientForm";

interface ClientEditorProps {
    client: Client;
    /** Must reject on failure -- the card's footer is where the error is shown. */
    onSave: (id: string, data: UpdateClient) => Promise<void>;
}

/**
 * Edits what a client *is*: its name, its site, and the address it is reached at or the
 * addresses it may connect from. A page of its own, at `ROUTES.clientEdit`.
 *
 * Leaving is a navigation, and the control for it sits in the card's header -- the one part
 * of the form that is in reach from every scroll position without a floating bar over the
 * content. Where it goes is the route above: the client's page, whether the editor was
 * opened from there or from the client list. Unsaved work is asked about on every way out,
 * by `useUnsavedChangesGuard`.
 *
 * The form is held here and not in the card, because this is where both of its readers
 * are: the card shows it, the guard asks about it.
 */
export const ClientEditor = ({ client, onSave }: ClientEditorProps) => {
    // The caller may hold a snapshot from when the editor opened; status and version arrive
    // over the socket afterwards, so read the client from the cache rather than the prop.
    const live = useClient(client.id) ?? client;

    // Fixed for the life of the page: a client does not change its connection mode.
    const outbound = isOutbound(client);
    const form = useEntityForm({
        schema: UpdateClientSchema,
        initial: () => clientDraftFrom(client),
        // Against the live client: what is stored is what decides which keys are sent.
        toInput: (draft: ClientDraft) => clientInputFrom(draft, outbound, live),
        fieldOf: clientFieldOf,
        rules: (draft) => clientRules(draft, outbound),
        significant: (draft) => significantClientDraft(draft, outbound),
    });
    const { close } = useUnsavedChangesGuard(form.isDirty, "client");

    return (
        <div className="space-y-6">
            <ClientIdentityCard
                client={live}
                form={form}
                onSubmit={() => form.submit((input) => onSave(client.id, input), { rebase: storedClientDraft })}
                action={<ActionButton icon={X} tooltip="Close" onClick={close} />}
            />
        </div>
    );
};
