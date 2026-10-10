import { Link } from "react-router-dom";
import { Badge, Card, DescriptionList, FOCUS_RING, StatusDot, cn, type DescriptionItem } from "@stefgo/react-ui-components";
import {
    FSMO_ROLES,
    FSMO_ROLE_LABELS,
    functionalLevelLabel,
    type DomainController,
    type DomainHealth,
    type DomainStatus,
} from "@sadm/shared";
import { RelativeTime } from "../../../components/RelativeTime";
import { paths } from "../../../lib/paths";
import { EMPTY_VALUE } from "../../../utils";
import { clockOffsetLabel, controllerSummary, replicationSummary } from "../lib/health";
import { DomainStatusBadge } from "./DomainStatusBadge";

const DOT: Record<DomainStatus, "success" | "warning" | "error" | "unknown"> = {
    healthy: "success",
    degraded: "warning",
    critical: "error",
    unknown: "unknown",
};

/** One domain controller: its name and status, what it holds, and its worst finding. */
const ControllerTile = ({ dc }: { dc: DomainController }) => {
    const replication = replicationSummary(dc.health);
    const body = (
        <>
            <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                    <StatusDot tone={dc.online ? DOT[dc.status] : "neutral"} />
                    <span className="truncate font-semibold text-text-primary">{dc.name}</span>
                </span>
                {dc.clientId === null ? (
                    <Badge variant="neutral">No agent</Badge>
                ) : dc.online ? (
                    <DomainStatusBadge status={dc.status} />
                ) : (
                    <Badge variant="warning">Offline</Badge>
                )}
            </div>
            <div className="mt-1 truncate text-xs text-text-muted">
                {[dc.site, dc.health?.identity?.sambaVersion && `Samba ${dc.health.identity.sambaVersion.split("-")[0]}`]
                    .filter(Boolean)
                    .join(" · ") || EMPTY_VALUE}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                    <dt className="text-text-muted">Roles</dt>
                    <dd className="font-medium text-text-primary">
                        {dc.roles.length}
                        {dc.isGlobalCatalog ? " · GC" : ""}
                    </dd>
                </div>
                <div>
                    <dt className="text-text-muted">Replication</dt>
                    <dd className={cn("font-medium", replication?.failing ? "text-error" : "text-text-primary")}>
                        {!dc.online || !replication
                            ? EMPTY_VALUE
                            : replication.failing > 0
                              ? `${replication.failing} failing`
                              : replication.oldestSuccess
                                ? <RelativeTime date={replication.oldestSuccess} />
                                : `${replication.partners} partner${replication.partners === 1 ? "" : "s"}`}
                    </dd>
                </div>
                <div>
                    <dt className="text-text-muted">Clock</dt>
                    <dd className="font-medium text-text-primary">
                        {dc.online ? clockOffsetLabel(dc.health?.clockOffsetMs) : EMPTY_VALUE}
                    </dd>
                </div>
            </dl>
            <p className="mt-3 truncate text-xs text-text-muted" title={controllerSummary(dc)}>
                {controllerSummary(dc)}
            </p>
        </>
    );
    const frame = "block rounded-lg border border-border bg-app-bg p-4";
    return dc.clientId ? (
        <Link to={paths.client(dc.clientId)} className={cn(frame, "hover:border-primary", FOCUS_RING)}>
            {body}
        </Link>
    ) : (
        <div className={frame}>{body}</div>
    );
};

/**
 * The domain at a glance: what it is called and how it is doing, who holds which role, and
 * a tile per domain controller.
 */
export const DomainOverviewCard = ({ domain }: { domain: DomainHealth }) => {
    const items: DescriptionItem[] = [
        { label: "Domain", value: domain.dnsName ?? EMPTY_VALUE },
        { label: "DN", value: domain.dn ?? EMPTY_VALUE, mono: true },
        {
            label: "Functional Level",
            value:
                domain.domainLevel === null
                    ? EMPTY_VALUE
                    : `Domain ${functionalLevelLabel(domain.domainLevel)} · Forest ${functionalLevelLabel(domain.forestLevel)}`,
        },
        ...FSMO_ROLES.map((role) => {
            const { holder, holders } = domain.fsmo[role];
            return {
                label: FSMO_ROLE_LABELS[role],
                value: holder ?? (holders.length > 1 ? <span className="text-error">{holders.join(" / ")}</span> : EMPTY_VALUE),
            };
        }),
    ];

    return (
        <Card
            title={
                <span className="flex flex-wrap items-center gap-2">
                    {domain.dnsName ?? "Domain"}
                    <DomainStatusBadge status={domain.status} />
                </span>
            }
            titleAs="h2"
            padding="md"
        >
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <DescriptionList items={items} columns={2} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:content-start">
                    {domain.controllers.map((dc) => (
                        <ControllerTile key={dc.name} dc={dc} />
                    ))}
                </div>
            </div>
        </Card>
    );
};
