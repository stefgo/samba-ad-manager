import { Monitor } from "lucide-react";
import { ReactNode, useMemo } from "react";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { Client, CLIENT_STATUS } from "@sadm/shared";
import { clientName, EMPTY_VALUE } from "../../../utils";
import { RelativeTime } from "../../../components/RelativeTime";
import {
    Badge,
    DataMultiView,
    EmptyState,
    type DataColumnDef,
    StatusDot,
    PAGE_SIZE,
    listPagination,
    actionsColumn,
    listGroups,
} from "@stefgo/react-ui-components";
import { STORAGE_KEYS } from "../../../lib/storageKeys";

/**
 * What the connected agent says it can do, reported as it named it. Only the agent on the
 * wire can answer this -- capabilities belong to the build that is connected -- so an
 * offline client says nothing rather than guessing from a stored version.
 *
 * The cell reports rather than interprets: a capability the dashboard does not know still
 * shows up here, and nothing is turned into a verdict about a single one of them. Where a
 * missing capability calls for an action, the place that asks for it says so.
 */
const CapabilitiesCell = ({ client }: { client: Client }) => {
    if (client.status !== CLIENT_STATUS.ONLINE || client.capabilities == null) {
        return <span className="text-sm text-text-muted">{EMPTY_VALUE}</span>;
    }
    if (client.capabilities.length === 0) {
        return <span className="text-sm text-text-muted">None</span>;
    }
    return (
        <span className="text-sm text-text-primary">{client.capabilities.join(", ")}</span>
    );
};

// Handed to the view instead of applied in front of it: only then can the view tell a search
// without a hit from a list with nothing in it.
const matchesSearch = (c: Client, query: string) => {
    const q = query.toLowerCase();
    return (
        (c.displayName ?? "").toLowerCase().includes(q) ||
        c.hostname.toLowerCase().includes(q) ||
        (c.site ?? "").toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
    );
};

interface ClientListProps {
    clients: Client[];
    setSelectedClient?: (client: Client | null) => void;
    renderRowActions?: (client: Client) => ReactNode;
    extraActions?: ReactNode;
}

export const ClientList = ({
    clients,
    setSelectedClient,
    renderRowActions,
    extraActions,
}: ClientListProps) => {
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    const sortedClients = useMemo(
        () => [...clients].sort((a, b) => clientName(a).localeCompare(clientName(b))),
        [clients],
    );

    const isOnline = (client: Client) => client.status === CLIENT_STATUS.ONLINE;

    // The table answers which client is gone and where it stands. What the agent is -- its
    // ID, version and capabilities -- is in the list view only.
    const columns: DataColumnDef<Client>[] = [
        {
            header: "Domain Controller",
            sortable: true,
            sortValue: (client) => clientName(client),
            list: { label: null },
            render: (client, view) => (
                <div className={view === "list" ? "flex items-center gap-2 py-1" : "flex items-center gap-3"}>
                    <StatusDot tone={isOnline(client) ? "success" : "neutral"} />
                    <div
                        className={`${view === "list" ? "" : "text-sm "}font-medium text-text-primary ${isOnline(client) ? "" : "opacity-70"} truncate`}
                    >
                        {clientName(client)}
                    </div>
                </div>
            ),
        },
        { header: "ID", accessorKey: "id", table: false },
        {
            header: "Site",
            sortable: true,
            sortValue: (client) => client.site ?? "",
            render: (client) => <span className="text-sm text-text-primary">{client.site || EMPTY_VALUE}</span>,
        },
        {
            header: "Version",
            table: false,
            render: (client) => <span className="text-sm text-text-primary">{client.version}</span>,
        },
        {
            header: "Capabilities",
            table: false,
            render: (client) => <CapabilitiesCell client={client} />,
        },
        {
            header: "Status",
            table: { cellClassName: "whitespace-nowrap" },
            render: (client) =>
                !isOnline(client) ? (
                    <span className="text-sm text-text-muted">
                        {client.lastSeen ? <>Last seen <RelativeTime date={client.lastSeen} /></> : "Never connected"}
                    </span>
                ) : (
                    <Badge variant="success">Online</Badge>
                ),
        },
        ...(renderRowActions
            ? [
                  actionsColumn<Client>((client) => (
                      <div onClick={(e) => e.stopPropagation()}>{renderRowActions(client)}</div>
                  )),
              ]
            : []),
    ];

    return (
        <DataMultiView
            title={
                <>
                    <Monitor size={18} className="text-text-muted" /> Clients
                </>
            }
            extraActions={extraActions}
            sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
            viewMode={{ persist: { key: STORAGE_KEYS.clientsView, scope: "local" } }}
            data={sortedClients}
            columns={columns}
            listGroups={listGroups()}
            keyField="id"
            searchable
            searchPlaceholder="Search name, hostname, site or ID…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            searchFilter={matchesSearch}
            noResultsMessage={`No domain controllers match “${searchQuery}”.`}
            emptyMessage={
                <EmptyState
                    icon={Monitor}
                    title="No domain controllers registered yet"
                    description="Add a domain controller, then start its agent with the registration token it is given."
                />
            }
            rowClassName="align-top"
            onRowClick={setSelectedClient ?? undefined}
            // The view owns the page state and takes the page after sorting, so a column
            // sort covers every client, not just the ones on screen.
            pagination={listPagination(PAGE_SIZE.page)}
        />
    );
};
