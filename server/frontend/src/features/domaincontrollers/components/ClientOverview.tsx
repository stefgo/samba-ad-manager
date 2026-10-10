import { Activity, DatabaseZap, MoreVertical, Edit, Unplug, WifiOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Client, CLIENT_STATUS, CONNECTION_MODE } from "@sadm/shared";
import { clientName, formatDate, getErrorMessage } from "../../../utils";
import { RelativeTime } from "../../../components/RelativeTime";
import { refreshDcHealth, runDbcheck, useDcHealth } from "../../../queries/dcHealth";
import { useDomainHealth } from "../../domain/hooks/useDomainHealth";
import { DcHealthPanel } from "../../domain/components/DcHealthPanel";
import { DomainStatusBadge } from "../../domain/components/DomainStatusBadge";
import { useBackPath } from "../../../hooks/useBackPath";
import { useEscapeToLeave } from "../../../hooks/useEscapeToLeave";
import {
    ActionButton,
    ActionMenu,
    Badge,
    EntityHeader,
    LoadingIndicator,
    type EntityDetail,
    useActionMenu,
    useToast,
    StatusDot,
    MenuItem,
} from "@stefgo/react-ui-components";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { ENTITY_HEADER } from "../../../components/entityHeader";
import { offlineNotice } from "../lib/offlineNotice";
import { notMeasuringNotice } from "../lib/notMeasuringNotice";
import { paths } from "../../../lib/paths";
import { STORAGE_KEYS } from "../../../lib/storageKeys";

interface ClientOverviewProps {
    client: Client;
}

export const ClientOverview = ({ client }: ClientOverviewProps) => {
    const navigate = useNavigate();
    // The client list, wherever this page was opened from: its parent in the route tree.
    const back = useBackPath();
    const { menuState, triggerRef, openMenu, closeMenu } = useActionMenu<string>();
    const { show } = useToast();
    const health = useDcHealth(client.id);
    const { domain } = useDomainHealth();
    const controller = domain.controllers.find((dc) => dc.clientId === client.id);

    // The measurement arrives over the socket, so the toast is all that says the click was taken.
    const handleMeasure = async () => {
        try {
            await refreshDcHealth(client.id);
            show({ variant: "success", title: `${clientName(client)} was measured` });
        } catch (e: unknown) {
            show({ variant: "error", title: `Could not measure ${clientName(client)}`, description: getErrorMessage(e) });
        }
    };

    const handleDbcheck = async () => {
        show({ variant: "info", title: "Database check started", description: "It may take a few minutes." });
        try {
            const result = await runDbcheck(client.id);
            if (result.errors === null) {
                show({ variant: "error", title: "The database check failed", description: result.error ?? undefined });
            } else {
                show({
                    variant: result.errors === 0 ? "success" : "warning",
                    title: result.errors === 0 ? "The database check found no errors" : `The database check found ${result.errors} error(s)`,
                });
            }
        } catch (e: unknown) {
            show({ variant: "error", title: "Could not run the database check", description: getErrorMessage(e) });
        }
    };

    // The client editor is a route of its own and handles its own Escape.
    useEscapeToLeave(back);

    const isOnline = client.status === CLIENT_STATUS.ONLINE;
    const isInbound = client.connectionMode !== CONNECTION_MODE.OUTBOUND;
    // Read off the finding, as every other verdict about a domain controller is.
    const isMeasuring = !controller?.issues.some((issue) => issue.type === "agent-not-measuring");
    const canMeasure = isOnline && isMeasuring;

    /**
     * What the header row has no room for: who the client is opens on request, connected
     * or not.
     */
    const details: EntityDetail[] = [
        { label: "ID", value: client.id, copyable: client.id },
        { label: "Agent", value: client.version || "Unknown" },
        isInbound
            ? { label: "Allowed IP", value: client.inboundAllowedIp || "Any" }
            : { label: "Target Address", value: client.outboundTargetAddress || "–" },
        ...(isInbound && client.inboundLastIp
            ? [{ label: "Last IP", value: client.inboundLastIp }]
            : []),
        ...(canMeasure
            ? [
                  {
                      label: "Directory Name",
                      value: health?.identity?.dnsHostName ?? health?.dcName ?? "–",
                      visibility: "always" as const,
                  },
                  {
                      label: "Measured",
                      value: health ? <RelativeTime date={health.collectedAt} seconds /> : "–",
                      visibility: "always" as const,
                  },
              ]
            : isOnline
              ? []
              : [{ label: "Last Seen", value: formatDate(client.lastSeen) }]),
    ];

    const notice = isOnline ? notMeasuringNotice() : offlineNotice({ lastSeen: client.lastSeen });
    const NoticeIcon = isOnline ? Unplug : WifiOff;

    return (
        <div className="space-y-6">
            <EntityHeader
                leading={<StatusDot tone={isOnline ? "success" : "neutral"} size="md" />}
                title={<HeaderBreadcrumb>{`${client.site ? `${client.site} / ` : ""}${clientName(client)}`}</HeaderBreadcrumb>}
                classNames={ENTITY_HEADER}
                meta={
                    <>
                        <Badge variant="info">{isInbound ? "Inbound" : "Outbound"}</Badge>
                        {!isOnline && <Badge variant="warning">Offline</Badge>}
                        {canMeasure && controller && <DomainStatusBadge status={controller.status} />}
                        {isOnline && !isMeasuring && <Badge variant="warning">Not measuring</Badge>}
                    </>
                }
                details={details}
                // Names the view, not the client: one entry for every client page.
                persist={{ key: STORAGE_KEYS.clientDetails, scope: "local" }}
                actions={
                    <div className="relative">
                        <ActionButton
                            icon={MoreVertical}
                            aria-label="Domain controller actions"
                            onClick={(e) => openMenu(e, client.id)}
                        />
                        <ActionMenu
                            isOpen={menuState?.id === client.id}
                            onClose={closeMenu}
                            anchor={menuState?.anchor ?? null}
                            triggerRef={triggerRef}
                        >
                            <MenuItem icon={Activity} disabled={!canMeasure} onClick={() => void handleMeasure()}>
                                Measure now
                            </MenuItem>
                            <MenuItem icon={DatabaseZap} disabled={!canMeasure} onClick={() => void handleDbcheck()}>
                                Run database check
                            </MenuItem>
                            <MenuItem
                                icon={Edit}
                                onClick={() => navigate(paths.clientEdit(client.id))}
                            >
                                Edit
                            </MenuItem>
                        </ActionMenu>
                    </div>
                }
            />

            {canMeasure &&
                (health && controller ? (
                    <DcHealthPanel controller={controller} health={health} />
                ) : (
                    <LoadingIndicator label="Waiting for the first measurement…" />
                ))}

            {!canMeasure && (
                <div role="status" className="flex gap-3 rounded-md border border-border bg-card p-4">
                    <NoticeIcon size={18} className="mt-0.5 shrink-0 text-warning" />
                    <div className="min-w-0">
                        <div className="font-medium text-text-primary">{notice.title}</div>
                        {notice.lines.map((line) => (
                            <p key={line} className="mt-1 text-sm text-text-muted">{line}</p>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
