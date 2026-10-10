import { Edit2, Plus, Trash2, Webhook as WebhookIcon } from "lucide-react";
import type { Webhook } from "@sadm/shared";
import {
    Badge,
    Button,
    DataAction,
    DataMultiView,
    EmptyState,
    type DataColumnDef,
    Switch,
    PAGE_SIZE,
    listPagination,
    actionsColumn,
    listGroups,
} from "@stefgo/react-ui-components";
import { formatDate } from "../../../utils";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { STORAGE_KEYS } from "../../../lib/storageKeys";

interface WebhookListProps {
    webhooks: Webhook[];
    isLoading: boolean;
    onAdd: () => void;
    onEdit: (webhook: Webhook) => void;
    onDelete: (webhook: Webhook) => void;
    onToggleEnabled: (webhook: Webhook, enabled: boolean) => void;
}

/** The table has a column with a switch for the state; the list shows it as a badge. */
const Name = ({ webhook, withState = false }: { webhook: Webhook; withState?: boolean }) => (
    <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-text-primary">{webhook.name}</span>
        {withState && !webhook.enabled && (
            <Badge variant="neutral">
                Disabled
            </Badge>
        )}
    </div>
);

const Target = ({ webhook }: { webhook: Webhook }) => (
    <span className="block max-w-md truncate text-sm text-text-muted" title={webhook.url}>
        {webhook.method} {webhook.url}
    </span>
);

const Filter = ({ webhook }: { webhook: Webhook }) => (
    <span className="text-sm text-text-muted">
        {webhook.minLevel} and above · {webhook.kinds.length > 0 ? webhook.kinds.join(", ") : "all kinds"}
    </span>
);

/**
 * How the last delivery went: when, and the answer's status as a badge -- "Failed" when
 * nothing answered. A failure carries its reason below; a long one wraps onto a second
 * line and is cut there, the tooltip has all of it.
 */
const LastDelivery = ({ webhook }: { webhook: Webhook }) => {
    if (!webhook.lastAttemptAt) {
        return (
            <Badge variant="neutral">
                Never sent
            </Badge>
        );
    }
    const failed = webhook.lastError !== null;
    return (
        <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-2">
                <span className="whitespace-nowrap text-sm text-text-primary">
                    {formatDate(webhook.lastAttemptAt)}
                </span>
                <Badge variant={failed ? "error" : "success"}>
                    {webhook.lastStatus !== null ? `HTTP ${webhook.lastStatus}` : "Failed"}
                </Badge>
            </div>
            {failed && (
                <span
                    className="line-clamp-2 max-w-sm break-words text-xs text-error"
                    title={webhook.lastError ?? undefined}
                >
                    {webhook.lastError}
                </span>
            )}
        </div>
    );
};

// Handed to the view instead of applied in front of it: only then can the view tell a search
// without a hit from a list with nothing in it.
const matchesSearch = (w: Webhook, query: string) => {
    const q = query.toLowerCase();
    return w.name.toLowerCase().includes(q) || w.url.toLowerCase().includes(q);
};

/** The webhooks, built like every other list of the app. Only the edit button opens the editor. */
export const WebhookList = ({ webhooks, isLoading, onAdd, onEdit, onDelete, onToggleEnabled }: WebhookListProps) => {
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    const renderActions = (webhook: Webhook) => (
        <DataAction
            rowId={webhook.id}
            actions={[
                {
                    icon: Edit2,
                    onClick: () => onEdit(webhook),
                    color: "blue",
                    tooltip: "Edit",
                },
            ]}
            menuEntries={[
                {
                    label: "Delete",
                    icon: Trash2,
                    onClick: () => onDelete(webhook),
                    variant: "danger",
                },
            ]}
        />
    );

    const renderEnabled = (webhook: Webhook) => (
        <div className="flex justify-center">
            <Switch
                value={webhook.enabled}
                onChange={(enabled) => onToggleEnabled(webhook, enabled)}
                aria-label={`${webhook.name} enabled`}
            />
        </div>
    );

    const columns: DataColumnDef<Webhook>[] = [
        {
            header: "Name",
            sortable: true,
            sortValue: (w) => w.name.toLowerCase(),
            list: { label: null },
            // The list has no Enabled column: the name carries the state instead.
            render: (w, view) =>
                view === "list" ? (
                    <div className="py-1">
                        <Name webhook={w} withState />
                    </div>
                ) : (
                    <Name webhook={w} />
                ),
        },
        {
            header: "Enabled",
            sortable: true,
            sortValue: (w) => (w.enabled ? 0 : 1),
            table: { headerClassName: "text-center", cellClassName: "content-center" },
            list: false,
            render: renderEnabled,
        },
        { header: "Target", table: false, render: (w) => <Target webhook={w} /> },
        { header: "Filter", table: false, render: (w) => <Filter webhook={w} /> },
        {
            header: "Last Delivery",
            sortable: true,
            sortValue: (w) => w.lastAttemptAt ?? "",
            render: (w) => <LastDelivery webhook={w} />,
        },
        actionsColumn(renderActions),
    ];

    return (
        <DataMultiView
            title={
                <>
                    <WebhookIcon size={18} className="text-text-muted" /> Webhooks
                </>
            }
            extraActions={
                <Button size="sm" icon={Plus} onClick={onAdd}>
                    Add Webhook
                </Button>
            }
            sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
            viewMode={{ persist: { key: STORAGE_KEYS.webhooksView, scope: "local" } }}
            data={webhooks}
            columns={columns}
            listGroups={listGroups("flex-1 min-w-0")}
            keyField="id"
            isLoading={isLoading}
            loadingMessage="Loading webhooks…"
            searchable
            searchPlaceholder="Search webhooks…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            searchFilter={matchesSearch}
            noResultsMessage={`No webhooks match “${searchQuery}”.`}
            emptyMessage={
                <EmptyState
                    icon={WebhookIcon}
                    title="No webhooks yet"
                    description="Add one to report events to an external service."
                />
            }
            pagination={listPagination(PAGE_SIZE.page)}
        />
    );
};
