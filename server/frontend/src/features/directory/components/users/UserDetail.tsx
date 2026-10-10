import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { KeyRound, LockOpen, MoreVertical, Pencil, UserCheck, UserPlus, UserX, Users, X } from "lucide-react";
import {
    ActionButton,
    ActionMenu,
    Badge,
    Button,
    DataAction,
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
import type { DirectoryRef, DirectoryUser } from "@sadm/shared";
import { ENTITY_HEADER } from "../../../../components/entityHeader";
import { QueryError } from "../../../../components/QueryError";
import { RelativeTime } from "../../../../components/RelativeTime";
import { useBackPath } from "../../../../hooks/useBackPath";
import { useEscapeToLeave } from "../../../../hooks/useEscapeToLeave";
import { ApiError } from "../../../../lib/api";
import { NotFoundError } from "../../../../lib/notFound";
import { ROUTES, directoryUnitPath } from "../../../../lib/paths";
import { STORAGE_KEYS } from "../../../../lib/storageKeys";
import { directoryApi, useDirectoryChange, useDirectoryUser } from "../../../../queries/directory";
import { EMPTY_VALUE, formatDate } from "../../../../utils";
import { HeaderBreadcrumb } from "../../../app/HeaderBreadcrumb";
import { describeDisableAccount, describeRemoveMember } from "../../confirmations";
import { DirectoryGate } from "../DirectoryGate";
import { useObjectActions } from "../ObjectActions";
import { ObjectPickerDialog, PasswordDialog } from "../ObjectDialogs";
import { RefTable } from "../RefTable";
import { UserFormDialog } from "./UserFormDialog";
import { UserStatus } from "./UserStatus";

const User = ({ user, writable }: { user: DirectoryUser; writable: boolean }) => {
    const back = useBackPath();
    const { confirm } = useConfirm();
    const { show } = useToast();
    const { menuState, triggerRef, openMenu, closeMenu } = useActionMenu<string>();
    const [dialog, setDialog] = useState<"edit" | "password" | "groups" | null>(null);

    const setEnabled = useDirectoryChange((enabled: boolean) => directoryApi.setEnabled(user.guid, enabled));
    const unlock = useDirectoryChange(() => directoryApi.unlockUser(user.guid));
    const setPassword = useDirectoryChange((input: Parameters<typeof directoryApi.setPassword>[1]) =>
        directoryApi.setPassword(user.guid, input),
    );
    const addToGroup = useDirectoryChange((group: string) => directoryApi.addMembers(group, [user.guid]));
    const removeFromGroup = useDirectoryChange((group: string) => directoryApi.removeMembers(group, [user.guid]));

    const actions = useObjectActions(
        { ...user, name: user.accountName, type: "user" },
        { afterDelete: ROUTES.directoryUsers, closeMenu },
    );

    useEscapeToLeave(back);

    const open = (which: "edit" | "password" | "groups") => {
        closeMenu();
        setDialog(which);
    };

    const report = async (work: () => Promise<unknown>, done: string, failed: string) => {
        closeMenu();
        try {
            await work();
            show({ variant: "success", title: done });
        } catch (e) {
            show({ variant: "error", title: failed, description: e instanceof Error ? e.message : undefined });
        }
    };

    const requestDisable = () => {
        closeMenu();
        confirm({
            ...describeDisableAccount({ name: user.accountName, type: "user" }),
            onConfirm: async () => {
                await setEnabled.mutateAsync(false);
            },
        });
    };

    const requestRemove = (group: DirectoryRef) =>
        confirm({
            ...describeRemoveMember(user.accountName, group.name),
            onConfirm: async () => {
                await removeFromGroup.mutateAsync(group.guid);
            },
        });

    const groups = user.memberOf ?? [];
    const details: EntityDetail[] = [
        { label: "Name", value: user.displayName || EMPTY_VALUE, visibility: "always" },
        { label: "E-mail", value: user.mail || EMPTY_VALUE, visibility: "always" },
        {
            label: "Location",
            value: (
                <Link to={directoryUnitPath(user.parentDn)} className={cn("rounded-sm hover:text-primary", FOCUS_RING)}>
                    {user.parentDn}
                </Link>
            ),
            visibility: "always",
        },
        { label: "Description", value: user.description || EMPTY_VALUE, visibility: "always" },
        { label: "User Principal Name", value: user.userPrincipalName || EMPTY_VALUE },
        { label: "First Name", value: user.givenName || EMPTY_VALUE },
        { label: "Last Name", value: user.surname || EMPTY_VALUE },
        { label: "Last Logon", value: user.lastLogon ? <RelativeTime date={user.lastLogon} /> : "Never" },
        { label: "Password Set", value: user.passwordLastSet ? formatDate(user.passwordLastSet) : "Never" },
        { label: "Password Expires", value: user.passwordNeverExpires ? "Never" : "By the domain's policy" },
        { label: "Account Expires", value: user.accountExpires ? formatDate(user.accountExpires) : "Never" },
        { label: "Created", value: formatDate(user.whenCreated) },
        { label: "Changed", value: formatDate(user.whenChanged) },
        { label: "SID", value: user.sid ?? EMPTY_VALUE, copyable: user.sid ?? undefined },
        { label: "GUID", value: user.guid, copyable: user.guid },
        { label: "Distinguished Name", value: user.dn, copyable: user.dn },
    ];

    return (
        <div className="space-y-6">
            <EntityHeader
                title={<HeaderBreadcrumb current={user.accountName}>{user.accountName}</HeaderBreadcrumb>}
                classNames={ENTITY_HEADER}
                meta={
                    <>
                        <UserStatus user={user} />
                        {user.protected && <Badge variant="neutral">Protected</Badge>}
                    </>
                }
                details={details}
                persist={{ key: STORAGE_KEYS.directoryDetails, scope: "local" }}
                actions={
                    writable && (
                        <div className="relative">
                            <ActionButton icon={MoreVertical} aria-label="User actions" onClick={(e) => openMenu(e, user.guid)} />
                            <ActionMenu
                                isOpen={menuState?.id === user.guid}
                                onClose={closeMenu}
                                anchor={menuState?.anchor ?? null}
                                triggerRef={triggerRef}
                            >
                                <MenuItem icon={Pencil} onClick={() => open("edit")}>
                                    Edit
                                </MenuItem>
                                <MenuItem icon={KeyRound} onClick={() => open("password")}>
                                    Set password
                                </MenuItem>
                                {user.lockedOut && (
                                    <MenuItem
                                        icon={LockOpen}
                                        onClick={() =>
                                            void report(
                                                () => unlock.mutateAsync(undefined),
                                                `${user.accountName} was unlocked`,
                                                `Could not unlock ${user.accountName}`,
                                            )
                                        }
                                    >
                                        Unlock
                                    </MenuItem>
                                )}
                                {user.enabled ? (
                                    <MenuItem
                                        icon={UserX}
                                        disabled={user.protected}
                                        disabledTitle="The directory needs this account."
                                        onClick={requestDisable}
                                    >
                                        Disable
                                    </MenuItem>
                                ) : (
                                    <MenuItem
                                        icon={UserCheck}
                                        onClick={() =>
                                            void report(
                                                () => setEnabled.mutateAsync(true),
                                                `${user.accountName} was enabled`,
                                                `Could not enable ${user.accountName}`,
                                            )
                                        }
                                    >
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
                objects={groups}
                empty={{ icon: Users, title: "Not a member of any group" }}
                extraActions={
                    writable && (
                        <Button size="sm" icon={UserPlus} onClick={() => setDialog("groups")}>
                            Add to Group
                        </Button>
                    )
                }
                renderRowActions={
                    writable
                        ? (group) =>
                              // The primary group is not a membership that can be taken away.
                              group.detail === "Primary group" ? null : (
                                  <DataAction
                                      rowId={group.guid}
                                      actions={[{ tooltip: `Remove from ${group.name}`, icon: X, onClick: () => requestRemove(group) }]}
                                  />
                              )
                        : undefined
                }
            />

            {dialog === "edit" && <UserFormDialog user={user} defaultParentDn={user.parentDn} onClose={() => setDialog(null)} />}
            {dialog === "password" && (
                <PasswordDialog
                    accountName={user.accountName}
                    passwordNeverExpires={user.passwordNeverExpires}
                    onClose={() => setDialog(null)}
                    onSave={async (input) => {
                        await setPassword.mutateAsync(input);
                        show({ variant: "success", title: `The password of ${user.accountName} was set` });
                    }}
                />
            )}
            {dialog === "groups" && (
                <ObjectPickerDialog
                    title={`Add ${user.accountName} to groups`}
                    types={["group"]}
                    confirmLabel="Add"
                    excludeGuids={new Set(groups.map((group) => group.guid))}
                    onClose={() => setDialog(null)}
                    onPick={async (picked) => {
                        // One group after the other: the first refusal stops, and says which.
                        for (const group of picked) await addToGroup.mutateAsync(group.guid);
                    }}
                />
            )}
            {actions.dialogs}
        </div>
    );
};

const UserPage = ({ writable }: { writable: boolean }) => {
    const { guid = "" } = useParams();
    const { data, isPending, error } = useDirectoryUser(guid);

    if (!data) {
        // Gone for good once the directory says so; anything else is a failed request.
        if (error instanceof ApiError && (error.status === 404 || error.status === 400)) throw new NotFoundError("user");
        if (error) return <QueryError title="Could not load the user" error={error} />;
        if (isPending) return <LoadingIndicator label="Loading user…" />;
        return null;
    }
    return <User user={data} writable={writable} />;
};

/** `/directory/users/:guid`: one user, what state it is in, and the groups it is a member of. */
export const UserDetail = () => <DirectoryGate>{({ writable }) => <UserPage writable={writable} />}</DirectoryGate>;
