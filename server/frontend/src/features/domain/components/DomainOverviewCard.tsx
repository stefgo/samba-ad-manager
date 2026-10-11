import { Link } from "react-router-dom";
import { Card, DescriptionList, FOCUS_RING, StatusDot, cn, type DescriptionItem } from "@stefgo/react-ui-components";
import {
    FSMO_ROLES,
    FSMO_ROLE_LABELS,
    functionalLevelLabel,
    type ControllerHealth,
    type DomainHealth,
} from "@sadm/shared";
import { RelativeTime } from "../../../components/RelativeTime";
import { paths } from "../../../lib/paths";
import { EMPTY_VALUE } from "../../../utils";
import { STATUS_TONE, clockOffsetLabel, controllerSummary, replicationSummary } from "../lib/health";
import { DomainStatusBadge } from "./DomainStatusBadge";

/** One domain controller: its name and status, what it holds, and its worst finding. */
const ControllerTile = ({ dc }: { dc: ControllerHealth }) => {
    const replication = replicationSummary(dc.health);
    const body = (
        <>
            <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                    <StatusDot tone={STATUS_TONE[dc.status]} />
                    <span className="truncate font-semibold text-text-primary">{dc.name}</span>
                </span>
                <DomainStatusBadge status={dc.status} />
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
                        {!replication
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
                        {clockOffsetLabel(dc.health?.clockOffsetMs)}
                    </dd>
                </div>
            </dl>
            <p className="mt-3 truncate text-xs text-text-muted" title={controllerSummary(dc)}>
                {controllerSummary(dc)}
            </p>
        </>
    );
    return (
        <Link
            to={paths.domainController(dc.id)}
            className={cn("block rounded-lg border border-border bg-app-bg p-4 hover:border-primary", FOCUS_RING)}
        >
            {body}
        </Link>
    );
};

/**
 * The domain at a glance: what it is called and how it is doing, who holds which role, and
 * a tile per domain controller.
 */
export const DomainOverviewCard = ({ domain }: { domain: DomainHealth }) => {
    const items: DescriptionItem[] = [
        { label: "Domain", value: domain.dnsName ?? EMPTY_VALUE, copyable: domain.dnsName ?? undefined },
        { label: "DN", value: domain.dn ?? EMPTY_VALUE, copyable: domain.dn ?? undefined },
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
                        <ControllerTile key={dc.id} dc={dc} />
                    ))}
                </div>
            </div>
        </Card>
    );
};
