import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MonitorCheck, MonitorX, MoreVertical, Pencil, Users } from "lucide-react";
import {
    ActionButton,
    ActionMenu,
    Badge,
    EntityHeader,
    FOCUS_RING,
    LoadingIndicator,
    MenuItem,
    cn,
    useActionMenu,
    useConfirm,
    useToast,
    type EntityDetail,
} from "@stefgo/react-ui-components";
import type { DirectoryComputer } from "@sadm/shared";
import { ENTITY_HEADER } from "../../../../components/entityHeader";
import { QueryError } from "../../../../components/QueryError";
import { RelativeTime } from "../../../../components/RelativeTime";
import { useBackPath } from "../../../../hooks/useBackPath";
import { useEscapeToLeave } from "../../../../hooks/useEscapeToLeave";
import { ApiError } from "../../../../lib/api";
import { NotFoundError } from "../../../../lib/notFound";
import { ROUTES, directoryUnitPath } from "../../../../lib/paths";
import { STORAGE_KEYS } from "../../../../lib/storageKeys";
import { directoryApi, useDirectoryChange, useDirectoryComputer } from "../../../../queries/directory";
import { EMPTY_VALUE, formatDate } from "../../../../utils";
import { HeaderBreadcrumb } from "../../../app/HeaderBreadcrumb";
import { describeDisableAccount } from "../../confirmations";
import { DirectoryGate } from "../DirectoryGate";
import { useObjectActions } from "../ObjectActions";
import { RefTable } from "../RefTable";
import { TextFieldsDialog } from "../TextFieldsDialog";
import { computerName } from "../../lib/objectLabels";

const Computer = ({ computer, writable }: { computer: DirectoryComputer; writable: boolean }) => {
    const back = useBackPath();
    const { confirm } = useConfirm();
    const { show } = useToast();
    const { menuState, triggerRef, openMenu, closeMenu } = useActionMenu<string>();
    const [isEditing, setIsEditing] = useState(false);
    const name = computerName(computer);

    const update = useDirectoryChange((changes: Record<string, string | null>) =>
        directoryApi.updateComputer(computer.guid, changes),
    );
    const setEnabled = useDirectoryChange((enabled: boolean) => directoryApi.setEnabled(computer.guid, enabled));
    const actions = useObjectActions({ ...computer, name, type: "computer" }, { afterDelete: ROUTES.directoryComputers, closeMenu });

    useEscapeToLeave(back);

    const requestDisable = () => {
        closeMenu();
        confirm({
            ...describeDisableAccount({ name, type: "computer" }),
            onConfirm: async () => {
                await setEnabled.mutateAsync(false);
            },
        });
    };

    const enable = async () => {
        closeMenu();
        try {
            await setEnabled.mutateAsync(true);
            show({ variant: "success", title: `${name} was enabled` });
        } catch (e) {
            show({ variant: "error", title: `Could not enable ${name}`, description: e instanceof Error ? e.message : undefined });
        }
    };

    const details: EntityDetail[] = [
        { label: "DNS Name", value: computer.dnsHostName || EMPTY_VALUE, visibility: "always" },
        {
            label: "Operating System",
            value: [computer.operatingSystem, computer.operatingSystemVersion].filter(Boolean).join(" ") || EMPTY_VALUE,
            visibility: "always",
        },
        {
            label: "Location",
            value: (
                <Link to={directoryUnitPath(computer.parentDn)} className={cn("rounded-sm hover:text-primary", FOCUS_RING)}>
                    {computer.parentDn}
                </Link>
            ),
            visibility: "always",
        },
        { label: "Description", value: computer.description || EMPTY_VALUE, visibility: "always" },
        { label: "Last Logon", value: computer.lastLogon ? <RelativeTime date={computer.lastLogon} /> : "Never" },
        { label: "Password Set", value: computer.passwordLastSet ? formatDate(computer.passwordLastSet) : "Never" },
        { label: "Created", value: formatDate(computer.whenCreated) },
        { label: "Changed", value: formatDate(computer.whenChanged) },
        { label: "Account", value: computer.accountName },
        { label: "SID", value: computer.sid ?? EMPTY_VALUE, copyable: computer.sid ?? undefined },
        { label: "GUID", value: computer.guid, copyable: computer.guid },
        { label: "Distinguished Name", value: computer.dn, copyable: computer.dn },
    ];

    return (
        <div className="space-y-6">
            <EntityHeader
                title={<HeaderBreadcrumb current={name}>{name}</HeaderBreadcrumb>}
                classNames={ENTITY_HEADER}
                meta={
                    <>
                        {computer.isDomainController && <Badge variant="info">Domain controller</Badge>}
                        <Badge variant={computer.enabled ? "success" : "neutral"}>{computer.enabled ? "Enabled" : "Disabled"}</Badge>
                        {computer.protected && <Badge variant="neutral">Protected</Badge>}
                    </>
                }
                details={details}
                persist={{ key: STORAGE_KEYS.directoryDetails, scope: "local" }}
                actions={
                    writable && (
                        <div className="relative">
                            <ActionButton icon={MoreVertical} aria-label="Computer actions" onClick={(e) => openMenu(e, computer.guid)} />
                            <ActionMenu
                                isOpen={menuState?.id === computer.guid}
                                onClose={closeMenu}
                                anchor={menuState?.anchor ?? null}
                                triggerRef={triggerRef}
                            >
                                <MenuItem
                                    icon={Pencil}
                                    onClick={() => {
                                        closeMenu();
                                        setIsEditing(true);
                                    }}
                                >
                                    Edit
                                </MenuItem>
                                {computer.enabled ? (
                                    <MenuItem
                                        icon={MonitorX}
                                        disabled={computer.protected}
                                        disabledTitle="A domain controller's account cannot be disabled from here."
                                        onClick={requestDisable}
                                    >
                                        Disable
                                    </MenuItem>
                                ) : (
                                    <MenuItem icon={MonitorCheck} onClick={() => void enable()}>
                                        Enable
                                    </MenuItem>
                                )}
                                {actions.menuItems}
                            </ActionMenu>
                        </div>
                    )
                }
            />

            <RefTable
                title={
                    <>
                        <Users size={18} className="text-text-muted" /> Member Of
                    </>
                }
                objects={computer.memberOf ?? []}
                empty={{ icon: Users, title: "Not a member of any group" }}
            />

            {isEditing && (
                <TextFieldsDialog
                    title={`Edit ${name}`}
                    fields={[{ key: "description", label: "Description", max: 1024 }]}
                    values={{ description: computer.description }}
                    onClose={() => setIsEditing(false)}
                    onSave={(changes) => update.mutateAsync(changes)}
                />
            )}
            {actions.dialogs}
        </div>
    );
};

const ComputerPage = ({ writable }: { writable: boolean }) => {
    const { guid = "" } = useParams();
    const { data, isPending, error } = useDirectoryComputer(guid);

    if (!data) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 400)) throw new NotFoundError("computer");
        if (error) return <QueryError title="Could not load the computer" error={error} />;
        if (isPending) return <LoadingIndicator label="Loading computer…" />;
        return null;
    }
    return <Computer computer={data} writable={writable} />;
};

/** `/directory/computers/:guid`: one computer account. */
export const ComputerDetail = () => <DirectoryGate>{({ writable }) => <ComputerPage writable={writable} />}</DirectoryGate>;
