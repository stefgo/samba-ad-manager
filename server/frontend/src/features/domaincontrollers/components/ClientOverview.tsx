import { MoreVertical, Edit, WifiOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Client, CLIENT_STATUS, CONNECTION_MODE } from "@sadm/shared";
import { clientName, formatDate } from "../../../utils";
import { useBackPath } from "../../../hooks/useBackPath";
import { useEscapeToLeave } from "../../../hooks/useEscapeToLeave";
import {
    ActionButton,
    ActionMenu,
    Badge,
    EntityHeader,
    type EntityDetail,
    useActionMenu,
    StatusDot,
    MenuItem,
} from "@stefgo/react-ui-components";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { ENTITY_HEADER } from "../../../components/entityHeader";
import { offlineNotice } from "../lib/offlineNotice";
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

    // The client editor is a route of its own and handles its own Escape.
    useEscapeToLeave(back);

    const isOnline = client.status === CLIENT_STATUS.ONLINE;
    const isInbound = client.connectionMode !== CONNECTION_MODE.OUTBOUND;

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
        ...(isOnline ? [] : [{ label: "Last Seen", value: formatDate(client.lastSeen) }]),
    ];

    const notice = offlineNotice({ lastSeen: client.lastSeen });

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

            {!isOnline && (
                <div role="status" className="flex gap-3 rounded-md border border-border bg-card p-4">
                    <WifiOff size={18} className="mt-0.5 shrink-0 text-warning" />
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
