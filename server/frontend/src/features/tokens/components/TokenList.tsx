import { Key, Trash2 } from "lucide-react";
import { Token } from "@sadm/shared";
import {
    Badge,
    DataAction,
    DataMultiView,
    EmptyState,
    type DataColumnDef,
    PAGE_SIZE,
    listPagination,
    actionsColumn,
    listGroups,
} from "@stefgo/react-ui-components";
import { formatDate } from "../../../utils";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { STORAGE_KEYS } from "../../../lib/storageKeys";

interface TokenListProps {
    tokens: Token[];
    isLoading: boolean;
    deleteToken: (token: Token) => void;
}

const isExpired = (t: Token) => new Date(t.expiresAt) < new Date();

/**
 * The token's SHA-256 hash, shortened like a commit hash; the full value is in the tooltip.
 * The token itself was shown once, when it was issued, and the server does not keep it.
 */
const TokenHash = ({ token: t }: { token: Token }) => (
    <span
        title={t.tokenHash}
        className={`font-mono text-sm text-text-primary ${t.usedAt || isExpired(t) ? "line-through opacity-60" : ""}`}
    >
        {t.tokenHash.slice(0, 12)}
    </span>
);

/**
 * What the token fixes for the client it creates. A token issued before these existed
 * carries neither, and says so rather than showing blanks.
 */
const ClientDefaults = ({ token: t }: { token: Token }) => {
    if (!t.displayName && !t.inboundAllowedIp) {
        return <span className="text-sm text-text-muted opacity-60">From the agent</span>;
    }
    return (
        <div className="text-sm text-text-muted">
            {t.displayName && <div className="text-text-primary">{t.displayName}</div>}
            {t.inboundAllowedIp && <div className="font-mono text-xs">{t.inboundAllowedIp}</div>}
        </div>
    );
};

const Validity = ({ token: t }: { token: Token }) => {
    if (t.usedAt) return <>Used: {formatDate(t.usedAt)}</>;
    if (isExpired(t)) return <>Expired: {formatDate(t.expiresAt)}</>;
    return <>Expires: {formatDate(t.expiresAt)}</>;
};

const StatusBadge = ({ token: t }: { token: Token }) => {
    if (t.usedAt) return <Badge variant="neutral">Used</Badge>;
    if (isExpired(t)) return <Badge variant="error">Expired</Badge>;
    return <Badge variant="success">Active</Badge>;
};

// Handed to the view instead of applied in front of it: only then can the view tell a search
// without a hit from a list with nothing in it.
const matchesSearch = (t: Token, query: string) => {
    const q = query.toLowerCase();
    return (
        t.tokenHash.includes(q) ||
        (t.displayName ?? "").toLowerCase().includes(q) ||
        (t.inboundAllowedIp ?? "").toLowerCase().includes(q)
    );
};

/**
 * The registration tokens, built like every other list of the app. Tokens are issued in the
 * add-client wizard, which is also where the two defaults a token carries are entered -- a
 * second entry point here would be a token without them, so the list has no add button.
 */
export const TokenList = ({ tokens, isLoading, deleteToken }: TokenListProps) => {
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    const renderActions = (t: Token) => (
        <div onClick={(e) => e.stopPropagation()}>
            <DataAction
                rowId={t.tokenHash}
                menuEntries={[
                    {
                        label: "Delete",
                        icon: Trash2,
                        onClick: () => deleteToken(t),
                        variant: "danger",
                    },
                ]}
            />
        </div>
    );

    const columns: DataColumnDef<Token>[] = [
        {
            header: "Token Hash",
            list: { label: null },
            // The list has no Status column of its own: the badge leads the row instead.
            render: (t, view) =>
                view === "list" ? (
                    <div className="flex items-center gap-2 py-1">
                        <StatusBadge token={t} />
                        <TokenHash token={t} />
                    </div>
                ) : (
                    <TokenHash token={t} />
                ),
        },
        {
            header: "Domain Controller",
            render: (t) => <ClientDefaults token={t} />,
        },
        {
            header: "Expires / Used",
            sortable: true,
            sortValue: (t) => t.usedAt ?? t.expiresAt,
            table: { cellClassName: "text-sm text-text-muted" },
            list: { label: "Validity" },
            render: (t, view) =>
                view === "list" ? (
                    <span className="text-sm text-text-muted">
                        <Validity token={t} />
                    </span>
                ) : (
                    <Validity token={t} />
                ),
        },
        {
            header: "Status",
            sortable: true,
            sortValue: (t) => (t.usedAt ? 2 : isExpired(t) ? 1 : 0),
            list: false,
            render: (t) => <StatusBadge token={t} />,
        },
        actionsColumn(renderActions),
    ];

    return (
        <DataMultiView
            title={
                <>
                    <Key size={18} className="text-text-muted" /> Client Tokens
                </>
            }
            sort={{ defaultValue: [{ colIndex: 2, direction: "asc" }] }}
            viewMode={{ persist: { key: STORAGE_KEYS.tokensView, scope: "local" } }}
            data={tokens}
            columns={columns}
            listGroups={listGroups("flex-1 min-w-0")}
            keyField="tokenHash"
            isLoading={isLoading}
            loadingMessage="Loading tokens…"
            searchable
            searchPlaceholder="Search tokens…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            searchFilter={matchesSearch}
            noResultsMessage={`No tokens match “${searchQuery}”.`}
            emptyMessage={
                <EmptyState
                    icon={Key}
                    title="No tokens yet"
                    description="A token is issued when a domain controller is added."
                />
            }
            pagination={listPagination(PAGE_SIZE.page)}
        />
    );
};
