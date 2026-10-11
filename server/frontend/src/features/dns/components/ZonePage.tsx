import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { Globe, ListTree, Lock } from "lucide-react";
import {
    Badge,
    DataMultiView,
    EmptyState,
    EntityHeader,
    LoadingIndicator,
    PAGE_SIZE,
    listGroups,
    listPagination,
    type DataColumnDef,
    type EntityDetail,
} from "@stefgo/react-ui-components";
import { formatDuration, type DnsZoneDetail } from "@sadm/shared";
import { ENTITY_HEADER } from "../../../components/entityHeader";
import { QueryError } from "../../../components/QueryError";
import { RelativeTime } from "../../../components/RelativeTime";
import { useBackPath } from "../../../hooks/useBackPath";
import { useEscapeToLeave } from "../../../hooks/useEscapeToLeave";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { ApiError } from "../../../lib/api";
import { NotFoundError } from "../../../lib/notFound";
import { STORAGE_KEYS } from "../../../lib/storageKeys";
import { useDnsZone } from "../../../queries/dns";
import { EMPTY_VALUE } from "../../../utils";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { DirectoryGate } from "../../directory/components/DirectoryGate";
import {
    PARTITION_HINTS,
    PARTITION_LABELS,
    isReverseZone,
    matchesRecordSearch,
    recordRows,
    recordSortName,
    type RecordRow,
} from "../lib/dnsLabels";

const PROTECTED_HINT = "A domain controller registered this record for itself. It is not changed from here.";

const Zone = ({ zone }: { zone: DnsZoneDetail }) => {
    const back = useBackPath();
    const [searchQuery, setSearchQuery] = useSearchQueryParam();
    const rows = useMemo(() => recordRows(zone.nodes), [zone.nodes]);

    useEscapeToLeave(back);

    const { soa } = zone;
    const details: EntityDetail[] = [
        { label: "Serial", value: soa?.serial ?? EMPTY_VALUE, visibility: "always" },
        { label: "Refresh", value: soa ? formatDuration(soa.refresh) : EMPTY_VALUE, visibility: "always" },
        { label: "Name Servers", value: zone.nameServers.join(", ") || EMPTY_VALUE, visibility: "always" },
        { label: "Names", value: zone.nodeCount, visibility: "always" },
        { label: "Retry", value: soa ? formatDuration(soa.retry) : EMPTY_VALUE },
        { label: "Expire", value: soa ? formatDuration(soa.expire) : EMPTY_VALUE },
        { label: "Minimum TTL", value: soa ? formatDuration(soa.minimum) : EMPTY_VALUE },
        { label: "Primary", value: soa?.primary || EMPTY_VALUE },
        { label: "Responsible", value: soa?.mailbox || EMPTY_VALUE },
        { label: "Kept In", value: PARTITION_HINTS[zone.partition] },
        { label: "GUID", value: zone.guid, copyable: zone.guid },
        { label: "Distinguished Name", value: zone.dn, copyable: zone.dn },
    ];

    const columns: DataColumnDef<RecordRow>[] = [
        {
            header: "Name",
            sortable: true,
            sortValue: recordSortName,
            list: { label: null },
            render: ({ node, record }) => (
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-text-primary">
                    <span className="truncate" title={node.fqdn}>
                        {node.name}
                    </span>
                    {record.protected && (
                        <span title={PROTECTED_HINT} className="shrink-0 text-text-muted">
                            <Lock size={14} aria-label="Protected" />
                        </span>
                    )}
                </span>
            ),
        },
        {
            header: "Type",
            sortable: true,
            sortValue: (row) => row.type,
            render: (row) => <Badge variant="neutral">{row.type}</Badge>,
        },
        {
            header: "Data",
            sortable: true,
            sortValue: (row) => row.text,
            render: (row) => <span className="break-all text-sm text-text-primary">{row.text}</span>,
        },
        {
            header: "TTL",
            sortable: true,
            sortValue: ({ record }) => record.ttl,
            table: { cellClassName: "whitespace-nowrap" },
            render: ({ record }) => <span className="text-sm text-text-muted">{formatDuration(record.ttl)}</span>,
        },
        {
            header: "Registered",
            sortable: true,
            sortValue: ({ record }) => record.registeredAt ?? "",
            table: { cellClassName: "whitespace-nowrap" },
            render: ({ record }) => (
                <span className="text-sm text-text-muted">
                    {record.registeredAt ? <RelativeTime date={record.registeredAt} /> : "Static"}
                </span>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <EntityHeader
                title={<HeaderBreadcrumb current={zone.name}>{zone.name}</HeaderBreadcrumb>}
                classNames={ENTITY_HEADER}
                meta={
                    <>
                        <Badge variant="neutral">{isReverseZone(zone) ? "Reverse" : "Forward"}</Badge>
                        <Badge variant="neutral">{PARTITION_LABELS[zone.partition]}</Badge>
                        {!soa && <Badge variant="warning">No SOA record</Badge>}
                    </>
                }
                details={details}
                persist={{ key: STORAGE_KEYS.dnsZoneDetails, scope: "local" }}
            />

            <DataMultiView
                title={
                    <>
                        <ListTree size={18} className="text-text-muted" /> Records
                    </>
                }
                data={rows}
                columns={columns}
                listGroups={listGroups()}
                keyField="key"
                sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
                viewMode={{ persist: { key: STORAGE_KEYS.dnsRecordsView, scope: "local" } }}
                searchable
                searchPlaceholder="Search name, type or data…"
                search={{ value: searchQuery, onChange: setSearchQuery }}
                searchFilter={matchesRecordSearch}
                noResultsMessage={`No records match “${searchQuery}”.`}
                emptyMessage={<EmptyState icon={Globe} title="The zone has no records" />}
                pagination={listPagination(PAGE_SIZE.page)}
            />
        </div>
    );
};

const ZoneRoute = () => {
    const { guid = "" } = useParams();
    const { data, isPending, error } = useDnsZone(guid);

    if (!data) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 400)) throw new NotFoundError("zone");
        if (error) return <QueryError title="Could not load the zone" error={error} />;
        if (isPending) return <LoadingIndicator label="Loading zone…" />;
        return null;
    }
    return <Zone zone={data} />;
};

/** `/dns/:guid`: one zone, with every record of every name in it. */
export const ZonePage = () => <DirectoryGate>{() => <ZoneRoute />}</DirectoryGate>;
