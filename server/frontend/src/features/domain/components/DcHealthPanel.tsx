import { ArrowDownToLine, ArrowUpFromLine, Cog } from "lucide-react";
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
    type DcHealth,
    type DcProcess,
    type DomainController,
    type ReplicationNeighbour,
} from "@sadm/shared";
import { RelativeTime } from "../../../components/RelativeTime";
import { EMPTY_VALUE, formatDate } from "../../../utils";
import { clockOffsetLabel, isServiceProcess } from "../lib/health";
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

const processColumns: DataColumnDef<DcProcess>[] = [
    {
        header: "Service",
        sortable: true,
        sortValue: (process) => process.name,
        render: (process) => (
            <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <StatusDot tone={process.pids.length > 0 ? "success" : "error"} pulse={false} />
                <span className="font-mono">{process.name}</span>
            </span>
        ),
    },
    {
        header: "Processes",
        render: (process) => <span className="text-sm text-text-primary">{process.pids.length}</span>,
    },
    {
        header: "PIDs",
        render: (process) => <span className="font-mono text-xs text-text-muted">{process.pids.join(", ")}</span>,
    },
];

interface DcHealthPanelProps {
    controller: DomainController;
    health: DcHealth;
}

/**
 * Everything one agent measured of its domain controller: what is wrong first, then who the
 * domain controller is, its replication links, and the services and ports it answers on.
 */
export const DcHealthPanel = ({ controller, health }: DcHealthPanelProps) => {
    const { identity, container, domain, replication, dbcheck } = health;

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

    const runtime: DescriptionItem[] = [
        ...(container
            ? [
                  { label: "Container", value: container.name, mono: true },
                  {
                      label: "State",
                      value: (
                          <span className="flex flex-wrap items-center gap-2">
                              <Badge variant={container.running ? "success" : "error"}>{container.state}</Badge>
                              {container.health && (
                                  <Badge variant={container.health === "healthy" ? "success" : "warning"}>
                                      {container.health}
                                  </Badge>
                              )}
                          </span>
                      ),
                  },
                  { label: "Image", value: container.image ?? EMPTY_VALUE, mono: true },
                  { label: "Started", value: container.startedAt ? <RelativeTime date={container.startedAt} /> : EMPTY_VALUE },
                  { label: "Restarts", value: container.restartCount ?? EMPTY_VALUE },
              ]
            : []),
        {
            label: "Database Check",
            value: !dbcheck ? (
                "Not run yet"
            ) : dbcheck.errors === null ? (
                <span className="text-error">Failed: {dbcheck.error ?? "unknown reason"}</span>
            ) : (
                <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={dbcheck.errors === 0 ? "success" : "warning"}>
                        {dbcheck.errors} {dbcheck.errors === 1 ? "error" : "errors"}
                    </Badge>
                    <span className="text-text-muted">
                        <RelativeTime date={dbcheck.checkedAt} />
                    </span>
                </span>
            ),
        },
        { label: "Measured", value: formatDate(health.collectedAt) },
    ];

    const services = (health.processes ?? []).filter((process) => isServiceProcess(process.name));

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
                <Card title="Runtime" padding="md">
                    <DescriptionList items={runtime} columns={2} />
                    {health.ports && health.ports.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                            {health.ports.map((port) => (
                                <span key={port.port} title={`${port.name}, port ${port.port}`}>
                                    <Badge variant={port.open ? "success" : "error"}>
                                        {port.name} {port.port}
                                    </Badge>
                                </span>
                            ))}
                        </div>
                    )}
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
                                : "It is read inside the Samba container, which takes samba.container in the agent's configuration."
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
                    columns={replicationColumns}
                    keyField={linkKey}
                    sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
                />
            )}

            {health.processes && (
                <DataMultiView
                    title={
                        <>
                            <Cog size={18} className="text-text-muted" /> Samba Services
                        </>
                    }
                    data={services}
                    columns={processColumns}
                    keyField="name"
                    sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
                    emptyMessage={
                        <EmptyState icon={Cog} title="No Samba service is running" description="Samba's own messaging lists none." />
                    }
                />
            )}
        </div>
    );
};
