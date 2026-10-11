import { useNavigate } from "react-router-dom";
import { Globe } from "lucide-react";
import {
    Badge,
    DataMultiView,
    EmptyState,
    PAGE_SIZE,
    listGroups,
    listPagination,
    type DataColumnDef,
} from "@stefgo/react-ui-components";
import { formatDuration, type DnsZone } from "@sadm/shared";
import { QueryError } from "../../../components/QueryError";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { paths } from "../../../lib/paths";
import { STORAGE_KEYS } from "../../../lib/storageKeys";
import { useDnsZones } from "../../../queries/dns";
import { EMPTY_VALUE } from "../../../utils";
import { DirectoryGate } from "../../directory/components/DirectoryGate";
import { useDomainHealth } from "../../domain/hooks/useDomainHealth";
import { PARTITION_LABELS, isReverseZone } from "../lib/dnsLabels";
import { ZONE_STATE_LABELS, ZONE_STATE_TONES, worstZoneState, zoneServers } from "../lib/zoneServers";

const NO_ZONES: DnsZone[] = [];

const matchesSearch = (zone: DnsZone, query: string) => {
    const q = query.toLowerCase();
    return zone.name.toLowerCase().includes(q) || zone.nameServers.some((server) => server.toLowerCase().includes(q));
};

const Zones = () => {
    const navigate = useNavigate();
    const { data, isPending, error } = useDnsZones();
    const [searchQuery, setSearchQuery] = useSearchQueryParam();
    const { domain } = useDomainHealth();

    if (error && data === undefined) return <QueryError title="Could not load the zones" error={error} />;

    const columns: DataColumnDef<DnsZone>[] = [
        {
            header: "Zone",
            sortable: true,
            sortValue: (zone) => zone.name,
            list: { label: null },
            render: (zone) => (
                <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Globe size={16} className="shrink-0 text-text-muted" />
                    {zone.name}
                </span>
            ),
        },
        {
            header: "Kind",
            sortable: true,
            sortValue: (zone) => Number(isReverseZone(zone)),
            render: (zone) => <span className="text-sm text-text-primary">{isReverseZone(zone) ? "Reverse" : "Forward"}</span>,
        },
        {
            header: "Names",
            sortable: true,
            sortValue: (zone) => zone.nodeCount,
            render: (zone) => <span className="text-sm text-text-primary">{zone.nodeCount}</span>,
        },
        {
            header: "Serial",
            sortable: true,
            sortValue: (zone) => zone.soa?.serial ?? -1,
            render: (zone) => <span className="text-sm text-text-primary">{zone.soa?.serial ?? EMPTY_VALUE}</span>,
        },
        {
            header: "Refresh",
            render: (zone) => (
                <span className="text-sm text-text-muted">{zone.soa ? formatDuration(zone.soa.refresh) : EMPTY_VALUE}</span>
            ),
        },
        {
            header: "Name Servers",
            render: (zone) => (
                <span className="text-sm text-text-muted">{zone.nameServers.join(", ") || EMPTY_VALUE}</span>
            ),
        },
        {
            header: "Served",
            render: (zone) => {
                const servers = zoneServers(domain, zone);
                const worst = worstZoneState(servers);
                if (!worst) return <span className="text-sm text-text-muted">{EMPTY_VALUE}</span>;
                const affected = servers.filter((server) => server.state === worst);
                return (
                    <Badge variant={ZONE_STATE_TONES[worst]}>
                        {worst === "in-step"
                            ? `${servers.length} in step`
                            : `${affected.map((server) => server.name).join(", ")}: ${ZONE_STATE_LABELS[worst].toLowerCase()}`}
                    </Badge>
                );
            },
        },
        {
            header: "Kept In",
            sortable: true,
            sortValue: (zone) => zone.partition,
            render: (zone) => (
                <span className="flex flex-wrap gap-1">
                    <Badge variant="neutral">{PARTITION_LABELS[zone.partition]}</Badge>
                    {!zone.soa && <Badge variant="warning">No SOA record</Badge>}
                </span>
            ),
        },
    ];

    return (
        <DataMultiView
            title={
                <>
                    <Globe size={18} className="text-text-muted" /> DNS Zones
                </>
            }
            data={data ?? NO_ZONES}
            columns={columns}
            listGroups={listGroups()}
            keyField="guid"
            isLoading={isPending}
            loadingMessage="Loading zones…"
            sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
            viewMode={{ persist: { key: STORAGE_KEYS.dnsZonesView, scope: "local" } }}
            searchable
            searchPlaceholder="Search zone or name server…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            searchFilter={matchesSearch}
            noResultsMessage={`No zones match “${searchQuery}”.`}
            emptyMessage={
                <EmptyState
                    icon={Globe}
                    title="The directory holds no DNS zones"
                    description="A domain that keeps its zones in files rather than in the directory has none to show here."
                />
            }
            onRowClick={(zone) => navigate(paths.dnsZone(zone.guid))}
            pagination={listPagination(PAGE_SIZE.page)}
        />
    );
};

/** `/dns`: every DNS zone the directory holds. */
export const ZoneList = () => <DirectoryGate>{() => <Zones />}</DirectoryGate>;
