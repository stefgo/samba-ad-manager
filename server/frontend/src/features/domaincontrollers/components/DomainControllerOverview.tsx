import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Edit, MapPin, MoreVertical, Plus, Trash2 } from "lucide-react";
import type { DomainController } from "@sadm/shared";
import {
    ActionButton,
    ActionMenu,
    Badge,
    Button,
    EntityHeader,
    LoadingIndicator,
    type EntityDetail,
    useActionMenu,
    useConfirm,
    useToast,
    StatusDot,
    MenuItem,
} from "@stefgo/react-ui-components";
import { EMPTY_VALUE, formatDate, getErrorMessage } from "../../../utils";
import { RelativeTime } from "../../../components/RelativeTime";
import {
    measureDomainController,
    useRemoveAgent,
    useUpdateAgent,
    useUpdateDomainController,
} from "../../../queries/domainControllers";
import { useDcHealth } from "../../../queries/dcHealth";
import { useDomainHealth } from "../../domain/hooks/useDomainHealth";
import { DcHealthPanel } from "../../domain/components/DcHealthPanel";
import { DomainStatusBadge } from "../../domain/components/DomainStatusBadge";
import { controllerTone } from "../../domain/lib/health";
import { useBackPath } from "../../../hooks/useBackPath";
import { useEscapeToLeave } from "../../../hooks/useEscapeToLeave";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { ENTITY_HEADER } from "../../../components/entityHeader";
import { paths } from "../../../lib/paths";
import { STORAGE_KEYS } from "../../../lib/storageKeys";
import { describeRemoveAgent } from "../confirmations";
import { agentDirection, canEditAgent } from "../lib/agentForm";
import { reachedAt } from "../lib/domainControllerForm";
import { AddressDialog } from "./AddressDialog";
import { DbcheckCard } from "./DbcheckCard";
import { EditAgentDialog } from "./EditAgentDialog";
import { LocalPanel } from "./LocalPanel";

interface DomainControllerOverviewProps {
    dc: DomainController;
}

/**
 * One domain controller: how it is doing, what was measured of it, and what its agent
 * reports -- what it reads locally, and the database check. What can be done here is to
 * measure it now, to say where it is reached, and to give it an agent or take it away.
 *
 * The agent has no card of its own: it is a part of the domain controller, so how it is
 * connected stands with the header's details and what can be done with it among the
 * header's actions.
 */
export const DomainControllerOverview = ({ dc }: DomainControllerOverviewProps) => {
    // The list of domain controllers, wherever this page was opened from: its parent in the route tree.
    const back = useBackPath();
    const { menuState, triggerRef, openMenu, closeMenu } = useActionMenu<string>();
    const { show } = useToast();
    const { confirm } = useConfirm();
    const navigate = useNavigate();
    const health = useDcHealth(dc.id);
    const { domain } = useDomainHealth();
    const controller = domain.controllers.find((other) => other.id === dc.id);
    const { mutateAsync: update } = useUpdateDomainController();
    const { mutateAsync: updateAgent } = useUpdateAgent();
    const { mutateAsync: removeAgent } = useRemoveAgent();
    const [editingAddress, setEditingAddress] = useState(false);
    const [editingAgent, setEditingAgent] = useState(false);
    const { agent } = dc;

    // The measurement arrives over the socket, so the toast is all that says the click was taken.
    const handleMeasure = async () => {
        try {
            await measureDomainController(dc.id);
            show({ variant: "success", title: `${dc.name} was measured` });
        } catch (e: unknown) {
            show({ variant: "error", title: `Could not measure ${dc.name}`, description: getErrorMessage(e) });
        }
    };

    useEscapeToLeave(back);

    /** What the header row has no room for: who the domain controller is opens on request. */
    const details: EntityDetail[] = [
        { label: "ID", value: dc.id, copyable: dc.id },
        { label: "Reached At", value: reachedAt(dc), copyable: dc.address || dc.dnsHostName || undefined, visibility: "always" },
        { label: "Measured", value: health ? <RelativeTime date={health.collectedAt} seconds /> : "–", visibility: "always" },
        { label: "Site", value: dc.site ?? "–" },
        { label: "First Seen", value: formatDate(dc.firstSeen) },
        // Whether it has an agent and whether that is connected is on display; who the agent is opens on request.
        {
            label: "Agent",
            value: agent ? (
                <Badge variant={agent.connected ? "success" : "warning"}>{agent.connected ? "Connected" : "Not connected"}</Badge>
            ) : (
                "None"
            ),
            visibility: "always",
        },
        ...(agent
            ? [
                  { label: "Agent Direction", value: agentDirection(agent) },
                  { label: "Agent Host", value: agent.hostname ?? EMPTY_VALUE },
                  { label: "Agent Version", value: agent.version ?? EMPTY_VALUE },
                  { label: "Agent Registered", value: <RelativeTime date={agent.registeredAt} /> },
                  {
                      label: agent.connected ? "Agent Connected Since" : "Agent Last Seen",
                      value: agent.lastSeen ? <RelativeTime date={agent.lastSeen} /> : "Never",
                  },
              ]
            : []),
    ];

    return (
        <div className="space-y-6">
            <EntityHeader
                leading={<StatusDot tone={controllerTone(controller)} size="md" />}
                title={<HeaderBreadcrumb>{dc.name}</HeaderBreadcrumb>}
                classNames={ENTITY_HEADER}
                meta={controller && <DomainStatusBadge status={controller.status} />}
                details={details}
                // Names the view, not the domain controller: one entry for every such page.
                persist={{ key: STORAGE_KEYS.domainControllerDetails, scope: "local" }}
                // Without an agent the header holds a button next to the menu, which is more than a title leaves room for.
                actionsBelow={!agent}
                actions={
                    <div className="relative flex items-center gap-2">
                        {!agent && (
                            <Button size="sm" icon={Plus} onClick={() => navigate(paths.domainControllerAgentNew(dc.id))}>
                                Add Agent
                            </Button>
                        )}
                        <ActionButton icon={MoreVertical} aria-label="Domain controller actions" onClick={(e) => openMenu(e, dc.id)} />
                        <ActionMenu
                            isOpen={menuState?.id === dc.id}
                            onClose={closeMenu}
                            anchor={menuState?.anchor ?? null}
                            triggerRef={triggerRef}
                        >
                            <MenuItem icon={Activity} onClick={() => void handleMeasure()}>
                                Measure now
                            </MenuItem>
                            <MenuItem icon={MapPin} onClick={() => setEditingAddress(true)}>
                                Set address
                            </MenuItem>
                            {/* An agent that dials in has nothing to edit: all there is to know of it, it says itself. */}
                            {agent && canEditAgent(agent) && (
                                <MenuItem icon={Edit} onClick={() => setEditingAgent(true)}>
                                    Edit Agent
                                </MenuItem>
                            )}
                            {agent && (
                                <MenuItem
                                    icon={Trash2}
                                    variant="danger"
                                    onClick={() => void confirm({ ...describeRemoveAgent(dc), onConfirm: () => removeAgent(dc.id) })}
                                >
                                    Remove Agent
                                </MenuItem>
                            )}
                        </ActionMenu>
                    </div>
                }
            />

            {health && controller ? (
                <DcHealthPanel controller={controller} health={health} />
            ) : (
                <LoadingIndicator label="Waiting for the first measurement…" />
            )}

            {dc.agent && health?.local && <LocalPanel health={health} local={health.local} connected={dc.agent.connected} />}

            <DbcheckCard dc={dc} dbcheck={health?.dbcheck ?? null} />

            {editingAgent && agent && (
                <EditAgentDialog dc={dc} agent={agent} onClose={() => setEditingAgent(false)} onSave={(data) => updateAgent({ id: dc.id, data })} />
            )}
            {editingAddress && (
                <AddressDialog dc={dc} onClose={() => setEditingAddress(false)} onSave={(data) => update({ id: dc.id, data })} />
            )}
        </div>
    );
};
