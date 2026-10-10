import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Monitor } from "lucide-react";
import {
    Badge,
    DataMultiView,
    EmptyState,
    PAGE_SIZE,
    listGroups,
    listPagination,
    type DataColumnDef,
} from "@stefgo/react-ui-components";
import type { DirectoryComputer } from "@sadm/shared";
import { QueryError } from "../../../../components/QueryError";
import { RelativeTime } from "../../../../components/RelativeTime";
import { useSearchQueryParam } from "../../../../hooks/useSearchQueryParam";
import { paths } from "../../../../lib/paths";
import { STORAGE_KEYS } from "../../../../lib/storageKeys";
import { useDirectoryComputers, useDirectoryTree } from "../../../../queries/directory";
import { EMPTY_VALUE } from "../../../../utils";
import { computerName } from "../../lib/objectLabels";
import { orderUnits, unitTrail } from "../../lib/unitTree";
import { DirectoryGate } from "../DirectoryGate";

const NO_COMPUTERS: DirectoryComputer[] = [];

const matchesSearch = (computer: DirectoryComputer, query: string) => {
    const q = query.toLowerCase();
    return [computer.accountName, computer.dnsHostName, computer.operatingSystem, computer.description].some((value) =>
        (value ?? "").toLowerCase().includes(q),
    );
};

const Computers = () => {
    const navigate = useNavigate();
    const { data, isPending, error } = useDirectoryComputers();
    const { data: tree } = useDirectoryTree();
    const [searchQuery, setSearchQuery] = useSearchQueryParam();
    const units = useMemo(() => orderUnits(tree?.containers ?? []), [tree]);

    if (error && data === undefined) return <QueryError title="Could not load the computers" error={error} />;

    const columns: DataColumnDef<DirectoryComputer>[] = [
        {
            header: "Name",
            sortable: true,
            sortValue: (computer) => computer.accountName,
            list: { label: null },
            render: (computer) => (
                <span className={`flex items-center gap-2 text-sm font-medium text-text-primary ${computer.enabled ? "" : "opacity-60"}`}>
                    <Monitor size={16} className="shrink-0 text-text-muted" />
                    {computerName(computer)}
                </span>
            ),
        },
        {
            header: "DNS Name",
            sortable: true,
            sortValue: (computer) => computer.dnsHostName ?? "",
            render: (computer) => <span className="font-mono text-xs text-text-primary">{computer.dnsHostName || EMPTY_VALUE}</span>,
        },
        {
            header: "Operating System",
            sortable: true,
            sortValue: (computer) => computer.operatingSystem ?? "",
            render: (computer) => (
                <span className="text-sm text-text-primary">
                    {[computer.operatingSystem, computer.operatingSystemVersion].filter(Boolean).join(" ") || EMPTY_VALUE}
                </span>
            ),
        },
        {
            header: "Location",
            sortable: true,
            sortValue: (computer) => unitTrail(units, computer.parentDn),
            render: (computer) => <span className="text-sm text-text-muted">{unitTrail(units, computer.parentDn)}</span>,
        },
        {
            header: "Last Logon",
            table: { cellClassName: "whitespace-nowrap" },
            sortable: true,
            sortValue: (computer) => computer.lastLogon ?? "",
            render: (computer) => (
                <span className="text-sm text-text-muted">
                    {computer.lastLogon ? <RelativeTime date={computer.lastLogon} /> : "Never"}
                </span>
            ),
        },
        {
            header: "Status",
            render: (computer) => (
                <span className="flex flex-wrap gap-1">
                    {computer.isDomainController && <Badge variant="info">Domain controller</Badge>}
                    <Badge variant={computer.enabled ? "success" : "neutral"}>{computer.enabled ? "Enabled" : "Disabled"}</Badge>
                </span>
            ),
        },
    ];

    return (
        <DataMultiView
            title={
                <>
                    <Monitor size={18} className="text-text-muted" /> Computers
                </>
            }
            data={data ?? NO_COMPUTERS}
            columns={columns}
            listGroups={listGroups()}
            keyField="guid"
            isLoading={isPending}
            loadingMessage="Loading computers…"
            sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
            viewMode={{ persist: { key: STORAGE_KEYS.directoryComputersView, scope: "local" } }}
            searchable
            searchPlaceholder="Search name, DNS name, operating system or description…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            searchFilter={matchesSearch}
            noResultsMessage={`No computers match “${searchQuery}”.`}
            emptyMessage={
                <EmptyState
                    icon={Monitor}
                    title="The directory has no computers"
                    description="A computer account is created when a machine joins the domain."
                />
            }
            onRowClick={(computer) => navigate(paths.directoryComputer(computer.guid))}
            pagination={listPagination(PAGE_SIZE.page)}
        />
    );
};

/** `/directory/computers`: every computer account of the domain, the domain controllers' own included. */
export const ComputerList = () => <DirectoryGate>{() => <Computers />}</DirectoryGate>;
