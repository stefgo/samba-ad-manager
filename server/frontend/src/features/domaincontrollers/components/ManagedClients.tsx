import { Plus, Edit, Trash2, RefreshCw } from "lucide-react";
import { Client, CLIENT_STATUS, CONNECTION_MODE } from "@sadm/shared";
import { ClientList } from "./ClientList";
import { reconnectClient } from "../../../queries/clients";
import { Button, DataAction, useConfirm, useToast } from "@stefgo/react-ui-components";
import { clientName, getErrorMessage } from "../../../utils";
import { describeDeleteClient } from "../confirmations";

interface ManagedClientsProps {
    clients: Client[];
    onSelect: (client: Client | null) => void;
    onRefresh: () => void;
    /** Resolves once the client is gone, so the dialog can hold its spinner until then; rejects on failure. */
    onDelete: (clientId: string) => Promise<void>;
    /** Opens the add wizard -- its own route, so the URL says what is on screen. */
    onAdd: () => void;
    /** Opens the client editor for this client. */
    onEdit: (client: Client) => void;
}

/**
 * The client list and the one thing only the list can do: delete a client.
 *
 * Everything that opens a form -- add and edit -- is a route of its own and therefore a
 * navigation, not a state flag here. This component used to swap both surfaces in and out
 * of the same `div`, which meant the URL described neither of them and a reload dropped the
 * operator back on the list.
 */
export const ManagedClients = ({
    clients,
    onSelect,
    onRefresh,
    onDelete,
    onAdd,
    onEdit,
}: ManagedClientsProps) => {
    const { confirm } = useConfirm();
    const { show } = useToast();

    // A failed delete keeps the dialog open with the message in it: the store reverts its
    // optimistic removal, so the row comes back, and closing would hide both the failure
    // and the button that retries it.
    const requestDelete = (client: Client) =>
        confirm({ ...describeDeleteClient(client), onConfirm: () => onDelete(client.id) });

    /** Only the server can dial an outbound client, so only an offline one of those is offered it. */
    const canReconnect = (client: Client) =>
        client.connectionMode === CONNECTION_MODE.OUTBOUND && client.status === CLIENT_STATUS.OFFLINE;

    const handleReconnect = async (client: Client) => {
        try {
            await reconnectClient(client.id);
            onRefresh();
            show({ variant: "success", title: `Reconnected to ${clientName(client)}` });
        } catch (e: unknown) {
            show({
                variant: "error",
                title: `Could not reconnect to ${clientName(client)}`,
                description: getErrorMessage(e),
            });
        }
    };

    return (
        <div id="client-list-section">
            <ClientList
                clients={clients}
                setSelectedClient={onSelect}
                renderRowActions={(client) => (
                    <DataAction
                        rowId={client.id}
                        menuEntries={[
                            ...(canReconnect(client)
                                ? [
                                      {
                                          label: "Reconnect",
                                          icon: RefreshCw,
                                          onClick: () => handleReconnect(client),
                                          variant: "default" as const,
                                      },
                                  ]
                                : []),
                            {
                                label: "Edit",
                                icon: Edit,
                                onClick: () => onEdit(client),
                                variant: "default",
                            },
                            {
                                label: "Delete",
                                icon: Trash2,
                                onClick: () => requestDelete(client),
                                variant: "danger",
                            },
                        ]}
                    />
                )}
                extraActions={
                    <Button size="sm" icon={Plus} onClick={onAdd}>
                        Add Domain Controller
                    </Button>
                }
            />

        </div>
    );
};
