import { useState } from "react";
import { Activity, MapPin, MoreVertical } from "lucide-react";
import type { DomainController } from "@sadm/shared";
import {
    ActionButton,
    ActionMenu,
    EntityHeader,
    LoadingIndicator,
    type EntityDetail,
    useActionMenu,
    useToast,
    StatusDot,
    MenuItem,
} from "@stefgo/react-ui-components";
import { formatDate, getErrorMessage } from "../../../utils";
import { RelativeTime } from "../../../components/RelativeTime";
import { measureDomainController, useUpdateDomainController } from "../../../queries/domainControllers";
import { useDcHealth } from "../../../queries/dcHealth";
import { useDomainHealth } from "../../domain/hooks/useDomainHealth";
import { DcHealthPanel } from "../../domain/components/DcHealthPanel";
import { DomainStatusBadge } from "../../domain/components/DomainStatusBadge";
import { controllerTone } from "../../domain/lib/health";
import { useBackPath } from "../../../hooks/useBackPath";
import { useEscapeToLeave } from "../../../hooks/useEscapeToLeave";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { ENTITY_HEADER } from "../../../components/entityHeader";
import { STORAGE_KEYS } from "../../../lib/storageKeys";
import { reachedAt } from "../lib/domainControllerForm";
import { AddressDialog } from "./AddressDialog";
import { DbcheckCard } from "./DbcheckCard";

interface DomainControllerOverviewProps {
    dc: DomainController;
}

/**
 * One domain controller: how it is doing, what was measured of it, and the database check
 * it reports. What can be done here is to measure it now and to say where it is reached.
 */
export const DomainControllerOverview = ({ dc }: DomainControllerOverviewProps) => {
    // The list of domain controllers, wherever this page was opened from: its parent in the route tree.
    const back = useBackPath();
    const { menuState, triggerRef, openMenu, closeMenu } = useActionMenu<string>();
    const { show } = useToast();
    const health = useDcHealth(dc.id);
    const { domain } = useDomainHealth();
    const controller = domain.controllers.find((other) => other.id === dc.id);
    const { mutateAsync: update } = useUpdateDomainController();
    const [editingAddress, setEditingAddress] = useState(false);

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
                actions={
                    <div className="relative">
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
                        </ActionMenu>
                    </div>
                }
            />

            {health && controller ? (
                <DcHealthPanel controller={controller} health={health} />
            ) : (
                <LoadingIndicator label="Waiting for the first measurement…" />
            )}

            <DbcheckCard dc={dc} dbcheck={health?.dbcheck ?? null} />

            {editingAddress && (
                <AddressDialog dc={dc} onClose={() => setEditingAddress(false)} onSave={(data) => update({ id: dc.id, data })} />
            )}
        </div>
    );
};
