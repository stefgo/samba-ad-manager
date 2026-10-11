import { Activity, Server } from "lucide-react";
import { ReactNode, useState } from "react";
import {
    Badge,
    Button,
    DataMultiView,
    type DataColumnDef,
    StatusDot,
    PAGE_SIZE,
    listPagination,
    listGroups,
    useToast,
} from "@stefgo/react-ui-components";
import { FSMO_ROLE_LABELS, type ControllerHealth } from "@sadm/shared";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { EMPTY_VALUE, getErrorMessage } from "../../../utils";
import { STORAGE_KEYS } from "../../../lib/storageKeys";
import { measureAllDomainControllers } from "../../../queries/domainControllers";
import { useDomainHealth } from "../../domain/hooks/useDomainHealth";
import { DomainStatusBadge } from "../../domain/components/DomainStatusBadge";
import { controllerTone } from "../../domain/lib/health";

// Handed to the view instead of applied in front of it: only then can the view tell a search
// without a hit from a list with nothing in it.
const matchesSearch = (dc: ControllerHealth, query: string) => {
    const q = query.toLowerCase();
    return (
        dc.name.toLowerCase().includes(q) ||
        (dc.dnsHostName ?? "").toLowerCase().includes(q) ||
        (dc.site ?? "").toLowerCase().includes(q) ||
        dc.id.toLowerCase().includes(q)
    );
};

// The table answers which domain controller is in trouble and what it holds. Its version
// and its id are in the list view only.
const columns: DataColumnDef<ControllerHealth>[] = [
    {
        header: "Domain Controller",
        sortable: true,
        sortValue: (dc) => dc.name,
        list: { label: null },
        render: (dc, view) => (
            <div className={view === "list" ? "flex items-center gap-2 py-1" : "flex items-center gap-3"}>
                <StatusDot tone={controllerTone(dc)} />
                <div className={`${view === "list" ? "" : "text-sm "}truncate font-medium text-text-primary`}>{dc.name}</div>
            </div>
        ),
    },
    {
        header: "DNS Name",
        sortable: true,
        sortValue: (dc) => dc.dnsHostName ?? "",
        render: (dc) => <span className="text-xs text-text-primary">{dc.dnsHostName ?? EMPTY_VALUE}</span>,
    },
    {
        header: "Roles",
        render: (dc) => {
            if (dc.roles.length === 0 && !dc.isGlobalCatalog) return <span className="text-sm text-text-muted">{EMPTY_VALUE}</span>;
            return (
                <span className="flex flex-wrap gap-1" title={dc.roles.map((role) => FSMO_ROLE_LABELS[role]).join(", ")}>
                    {dc.roles.length > 0 && <Badge variant="info">{dc.roles.length} FSMO</Badge>}
                    {dc.isGlobalCatalog && <Badge variant="neutral">GC</Badge>}
                </span>
            );
        },
    },
    {
        header: "Site",
        sortable: true,
        sortValue: (dc) => dc.site ?? "",
        render: (dc) => <span className="text-sm text-text-primary">{dc.site || EMPTY_VALUE}</span>,
    },
    {
        header: "Samba",
        table: false,
        render: (dc) => <span className="text-sm text-text-primary">{dc.health?.identity?.sambaVersion ?? EMPTY_VALUE}</span>,
    },
    { header: "ID", accessorKey: "id", table: false },
    {
        header: "Status",
        table: { cellClassName: "whitespace-nowrap" },
        render: (dc) => <DomainStatusBadge status={dc.status} />,
    },
];

interface DomainControllerListProps {
    onSelect?: (dc: ControllerHealth) => void;
    /** What stands in for the list while the directory has not named a single domain controller. */
    emptyMessage: ReactNode;
}

/**
 * The domain controllers the directory lists, each with how it is doing. Nothing is added
 * or removed here: the list is the directory's.
 */
export const DomainControllerList = ({ onSelect, emptyMessage }: DomainControllerListProps) => {
    const [searchQuery, setSearchQuery] = useSearchQueryParam();
    // As the domain's evaluation sees them, so the list and the dashboard cannot disagree.
    const { domain } = useDomainHealth();
    const { show } = useToast();
    const [isMeasuring, setIsMeasuring] = useState(false);

    // The measurements arrive over the socket, so the toast is all that says the click was taken.
    const handleMeasureAll = async () => {
        setIsMeasuring(true);
        try {
            await measureAllDomainControllers();
            show({ variant: "success", title: "Every domain controller was measured" });
        } catch (e: unknown) {
            show({ variant: "error", title: "Could not measure the domain controllers", description: getErrorMessage(e) });
        } finally {
            setIsMeasuring(false);
        }
    };

    return (
        <DataMultiView
            title={
                <>
                    <Server size={18} className="text-text-muted" /> Domain Controllers
                </>
            }
            extraActions={
                <Button
                    size="sm"
                    icon={Activity}
                    isLoading={isMeasuring}
                    disabled={domain.controllers.length === 0}
                    onClick={() => void handleMeasureAll()}
                >
                    Measure now
                </Button>
            }
            sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
            viewMode={{ persist: { key: STORAGE_KEYS.domainControllersView, scope: "local" } }}
            data={domain.controllers}
            columns={columns}
            listGroups={listGroups()}
            keyField="id"
            searchable
            searchPlaceholder="Search name, DNS name, site or ID…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            searchFilter={matchesSearch}
            noResultsMessage={`No domain controllers match “${searchQuery}”.`}
            emptyMessage={emptyMessage}
            rowClassName="align-top"
            onRowClick={onSelect}
            // The view owns the page state and takes the page after sorting, so a column
            // sort covers every domain controller, not just the ones on screen.
            pagination={listPagination(PAGE_SIZE.page)}
        />
    );
};
