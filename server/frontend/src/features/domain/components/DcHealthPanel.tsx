import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import {
    Badge,
    Card,
    DataMultiView,
    DescriptionList,
    EmptyState,
    StatusDot,
    type DataColumnDef,
    type DescriptionItem,
} from "@stefgo/react-ui-components";
import {
    FSMO_ROLE_LABELS,
    functionalLevelLabel,
    type ControllerHealth,
    type DcHealth,
    type ReplicationNeighbour,
} from "@sadm/shared";
import { RelativeTime } from "../../../components/RelativeTime";
import { EMPTY_VALUE, formatDate } from "../../../utils";
import { clockOffsetLabel, serviceNote } from "../lib/health";
import { IssueList } from "./IssueList";

const yesNo = (value: boolean | null | undefined): string => (value == null ? EMPTY_VALUE : value ? "Yes" : "No");

const time = (value: string | null | undefined) => (value ? <RelativeTime date={value} /> : "Never");

const linkKey = (link: ReplicationNeighbour) => `${link.partner}|${link.namingContext}`;

const replicationColumns: DataColumnDef<ReplicationNeighbour>[] = [
    {
        header: "Partner",
        sortable: true,
        sortValue: (link) => link.partner,
        render: (link) => (
            <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <StatusDot tone={link.consecutiveFailures > 0 ? "error" : link.lastSuccess ? "success" : "neutral"} pulse={false} />
                {link.partner}
            </span>
        ),
    },
    {
        header: "Naming Context",
        sortable: true,
        sortValue: (link) => link.namingContext,
        render: (link) => <span className="font-mono text-xs text-text-primary">{link.namingContext}</span>,
    },
    {
        header: "Last Success",
        table: { cellClassName: "whitespace-nowrap" },
        render: (link) => <span className="text-sm text-text-primary">{time(link.lastSuccess)}</span>,
    },
    {
        header: "Last Attempt",
        table: { cellClassName: "whitespace-nowrap" },
        render: (link) => <span className="text-sm text-text-primary">{time(link.lastAttempt)}</span>,
    },
    {
        header: "Result",
        render: (link) =>
            link.consecutiveFailures > 0 ? (
                <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="error">
                        {link.consecutiveFailures} {link.consecutiveFailures === 1 ? "failure" : "failures"}
                    </Badge>
                    <span className="font-mono text-xs text-text-muted">{link.resultText ?? link.resultCode}</span>
                </span>
            ) : link.lastAttempt ? (
                <Badge variant="success">OK</Badge>
            ) : (
                <span className="text-sm text-text-muted">Not tried yet</span>
            ),
    },
];

/** An outbound link names who is told about changes and keeps no times: there is nothing to judge it by. */
const outboundColumns: DataColumnDef<ReplicationNeighbour>[] = [
    {
        header: "Partner",
        sortable: true,
        sortValue: (link) => link.partner,
        render: (link) => <span className="text-sm font-medium text-text-primary">{link.partner}</span>,
    },
    replicationColumns[1],
];

interface DcHealthPanelProps {
    controller: ControllerHealth;
    health: DcHealth;
}

/**
 * Everything that was measured of one domain controller: what is wrong first, then who it
 * is, the services it answers on, and its replication links.
 */
export const DcHealthPanel = ({ controller, health }: DcHealthPanelProps) => {
    const { identity, domain, replication } = health;

    const about: DescriptionItem[] = [
        { label: "DNS Name", value: identity?.dnsHostName ?? EMPTY_VALUE, mono: true },
        { label: "Site", value: identity?.site ?? EMPTY_VALUE },
        { label: "Samba", value: identity?.sambaVersion ?? EMPTY_VALUE },
        { label: "Domain", value: domain?.dnsName ?? EMPTY_VALUE },
        {
            label: "Functional Level",
            value: domain
                ? `Domain ${functionalLevelLabel(domain.domainLevel)} · Forest ${functionalLevelLabel(domain.forestLevel)}`
                : EMPTY_VALUE,
        },
        { label: "Global Catalog", value: yesNo(identity?.isGlobalCatalog) },
        { label: "Synchronized", value: yesNo(identity?.isSynchronized) },
        { label: "Highest USN", value: identity?.highestCommittedUsn ?? EMPTY_VALUE, mono: true },
        { label: "Clock", value: clockOffsetLabel(health.clockOffsetMs) },
        { label: "Measured", value: formatDate(health.collectedAt) },
        {
            label: "FSMO Roles",
            span: "full",
            value:
                controller.roles.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                        {controller.roles.map((role) => (
                            <Badge key={role} variant="info">
                                {FSMO_ROLE_LABELS[role]}
                            </Badge>
                        ))}
                    </span>
                ) : (
                    "None"
                ),
        },
    ];

    return (
        <div className="space-y-6">
            {controller.issues.length > 0 && (
                <Card title="Findings">
                    <IssueList issues={controller.issues} withoutName />
                </Card>
            )}

            {health.errors.length > 0 && (
                <Card title="Not Measured">
                    <ul className="divide-y divide-border">
                        {health.errors.map((error) => (
                            <li key={error.source} className="px-4 py-3 text-sm">
                                <span className="font-medium text-text-primary">{error.source}</span>
                                <span className="text-text-muted"> — {error.message}</span>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <Card title="Domain Controller" padding="md">
                    <DescriptionList items={about} columns={2} />
                </Card>
                <Card title="Services">
                    <ul className="divide-y divide-border">
                        {health.services.map((service) => (
                            <li key={service.port} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                                <span className="flex min-w-0 items-center gap-2">
                                    <StatusDot tone={service.ok ? "success" : "error"} pulse={false} />
                                    <span className="truncate font-medium text-text-primary">{service.name}</span>
                                    <span className="font-mono text-xs text-text-muted">{service.port}</span>
                                </span>
                                <span className={service.ok ? "text-right text-xs text-text-muted" : "text-right text-xs text-error"}>
                                    {serviceNote(service)}
                                </span>
                            </li>
                        ))}
                    </ul>
                </Card>
            </div>

            <DataMultiView
                title={
                    <>
                        <ArrowDownToLine size={18} className="text-text-muted" /> Inbound Replication
                    </>
                }
                data={replication?.inbound ?? []}
                columns={replicationColumns}
                keyField={linkKey}
                sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
                emptyMessage={
                    <EmptyState
                        icon={ArrowDownToLine}
                        title={replication ? "No inbound replication link" : "Replication was not read"}
                        description={
                            replication
                                ? "This domain controller replicates from no other."
                                : "It is read from the directory, which did not answer or could not be read."
                        }
                    />
                }
            />

            {replication && replication.outbound.length > 0 && (
                <DataMultiView
                    title={
                        <>
                            <ArrowUpFromLine size={18} className="text-text-muted" /> Outbound Replication
                        </>
                    }
                    data={replication.outbound}
                    columns={outboundColumns}
                    keyField={linkKey}
                    sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
                />
            )}
        </div>
    );
};
