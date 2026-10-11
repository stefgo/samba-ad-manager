import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Globe, ListTree, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import {
    Badge,
    Button,
    Card,
    DataAction,
    DataMultiView,
    EmptyState,
    EntityHeader,
    FOCUS_RING,
    LoadingIndicator,
    PAGE_SIZE,
    listGroups,
    StatusDot,
    actionsColumn,
    cn,
    listPagination,
    useConfirm,
    useToast,
    type DataColumnDef,
    type EntityDetail,
} from "@stefgo/react-ui-components";
import { formatDuration, isManagedDnsType, type DnsZoneDetail } from "@sadm/shared";
import { ENTITY_HEADER } from "../../../components/entityHeader";
import { QueryError } from "../../../components/QueryError";
import { RelativeTime } from "../../../components/RelativeTime";
import { useBackPath } from "../../../hooks/useBackPath";
import { useEscapeToLeave } from "../../../hooks/useEscapeToLeave";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { ApiError } from "../../../lib/api";
import { NotFoundError } from "../../../lib/notFound";
import { paths } from "../../../lib/paths";
import { STORAGE_KEYS } from "../../../lib/storageKeys";
import { useDirectoryChange } from "../../../queries/directory";
import { dnsApi, useDnsZone } from "../../../queries/dns";
import { EMPTY_VALUE } from "../../../utils";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { DirectoryGate } from "../../directory/components/DirectoryGate";
import { useDomainHealth } from "../../domain/hooks/useDomainHealth";
import { describeDeleteRecord } from "../confirmations";
import {
    PARTITION_HINTS,
    PARTITION_LABELS,
    isReverseZone,
    matchesRecordSearch,
    recordRows,
    recordSortName,
    type RecordRow,
} from "../lib/dnsLabels";
import { ZONE_STATE_LABELS, ZONE_STATE_TONES, zoneServers, type ZoneServer } from "../lib/zoneServers";
import { EditRecordDialog, NewRecordDialog } from "./RecordDialog";

const PROTECTED_HINT = "One of the records a domain controller keeps for itself. It is not changed from here.";

/** What a server's row says beside its state: why it does not answer, or since when it is waiting. */
const ServerNote = ({ server }: { server: ZoneServer }) => {
    if (server.detail) return <>{server.detail}</>;
    if (server.outOfSyncSince) {
        return (
            <>
                another serial number since <RelativeTime date={server.outOfSyncSince} />
            </>
        );
    }
    return null;
};

/**
 * Who answers for the zone, and with which serial number: the domain controllers, and the
 * secondaries that transfer it from one. A change made in the directory is on a domain
 * controller at once and on a secondary when it next asks -- this is where that shows.
 */
const ZoneServers = ({ zone }: { zone: DnsZoneDetail }) => {
    const { domain } = useDomainHealth();
    const servers = zoneServers(domain, zone);
    if (servers.length === 0) return null;

    return (
        <Card title="Served By">
            <ul className="divide-y divide-border">
                {servers.map((server) => (
                    <li key={`${server.kind}|${server.name}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                            <StatusDot tone={ZONE_STATE_TONES[server.state]} pulse={false} />
                            {server.dcId ? (
                                <Link
                                    to={paths.domainController(server.dcId)}
                                    className={cn("truncate rounded-sm font-medium text-text-primary hover:text-primary", FOCUS_RING)}
                                >
                                    {server.name}
                                </Link>
                            ) : (
                                <span className="truncate font-medium text-text-primary">{server.name}</span>
                            )}
                            <span className="text-xs text-text-muted">
                                {server.kind === "domain-controller" ? "Domain controller" : "Secondary"}
                            </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                            <ServerNote server={server} />
                            {server.serial !== null && <span>Serial {server.serial}</span>}
                            <Badge variant={ZONE_STATE_TONES[server.state]}>{ZONE_STATE_LABELS[server.state]}</Badge>
                        </span>
                    </li>
                ))}
            </ul>
        </Card>
    );
};

const Zone = ({ zone, writable }: { zone: DnsZoneDetail; writable: boolean }) => {
    const back = useBackPath();
    const { confirm } = useConfirm();
    const { show } = useToast();
    const { domain } = useDomainHealth();
    const [searchQuery, setSearchQuery] = useSearchQueryParam();
    const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "edit"; row: RecordRow } | null>(null);
    const rows = useMemo(() => recordRows(zone.nodes), [zone.nodes]);
    const remove = useDirectoryChange((row: RecordRow) => dnsApi.deleteRecord(zone.guid, row.node.guid, { record: row.record.data }));

    useEscapeToLeave(back);

    /**
     * What a change is followed by: it is on the domain controllers at once, and on a
     * secondary when that next asks -- which is worth saying where there is one.
     */
    const stored = (title: string) => {
        const secondaries = zoneServers(domain, zone).filter((server) => server.kind === "secondary");
        show({
            variant: "success",
            title,
            description:
                secondaries.length > 0 && zone.soa
                    ? `The domain controllers answer with it now. ${secondaries.map((server) => server.name).join(", ")} ${secondaries.length === 1 ? "asks" : "ask"} for changes every ${formatDuration(zone.soa.refresh)} and ${secondaries.length === 1 ? "picks" : "pick"} it up then.`
                    : undefined,
        });
    };

    const requestDelete = (row: RecordRow) =>
        confirm({
            ...describeDeleteRecord(row, row.node.records.length === 1),
            onConfirm: async () => {
                await remove.mutateAsync(row);
                stored(`${row.node.fqdn} ${row.type} was deleted`);
            },
        });

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
        ...(writable
            ? [
                  actionsColumn<RecordRow>((row) => {
                      // A record a domain controller keeps is not changed; one that names none any more can still go.
                      const editable = !row.record.protected && isManagedDnsType(row.record.data.type);
                      const actions = [
                          ...(editable ? [{ tooltip: `Edit ${row.node.name} ${row.type}`, icon: Pencil, onClick: () => setDialog({ kind: "edit", row }) }] : []),
                          ...(row.record.deletable
                              ? [{ tooltip: `Delete ${row.node.name} ${row.type}`, icon: Trash2, onClick: () => requestDelete(row) }]
                              : []),
                      ];
                      return actions.length > 0 ? <DataAction rowId={row.key} actions={actions} /> : null;
                  }),
              ]
            : []),
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

            <ZoneServers zone={zone} />

            <DataMultiView
                title={
                    <>
                        <ListTree size={18} className="text-text-muted" /> Records
                    </>
                }
                extraActions={
                    writable && (
                        <Button size="sm" variant="primary" onClick={() => setDialog({ kind: "new" })}>
                            <Plus size={16} /> New Record
                        </Button>
                    )
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

            {dialog?.kind === "new" && (
                <NewRecordDialog zone={zone} onClose={() => setDialog(null)} onSaved={(fqdn) => stored(`${fqdn} was created`)} />
            )}
            {dialog?.kind === "edit" && (
                <EditRecordDialog
                    zone={zone}
                    node={dialog.row.node}
                    record={dialog.row.record}
                    onClose={() => setDialog(null)}
                    onSaved={(fqdn) => stored(`${fqdn} was saved`)}
                />
            )}
        </div>
    );
};

const ZoneRoute = ({ writable }: { writable: boolean }) => {
    const { guid = "" } = useParams();
    const { data, isPending, error } = useDnsZone(guid);

    if (!data) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 400)) throw new NotFoundError("zone");
        if (error) return <QueryError title="Could not load the zone" error={error} />;
        if (isPending) return <LoadingIndicator label="Loading zone…" />;
        return null;
    }
    return <Zone zone={data} writable={writable} />;
};

/** `/dns/:guid`: one zone, with every record of every name in it. */
export const ZonePage = () => <DirectoryGate>{({ writable }) => <ZoneRoute writable={writable} />}</DirectoryGate>;
