import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MoreVertical, Pencil, UserPlus, Users, X } from "lucide-react";
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
    type EntityDetail,
} from "@stefgo/react-ui-components";
import type { DirectoryGroup, DirectoryRef } from "@sadm/shared";
import { ENTITY_HEADER } from "../../../../components/entityHeader";
import { QueryError } from "../../../../components/QueryError";
import { useBackPath } from "../../../../hooks/useBackPath";
import { useEscapeToLeave } from "../../../../hooks/useEscapeToLeave";
import { ApiError } from "../../../../lib/api";
import { NotFoundError } from "../../../../lib/notFound";
import { ROUTES, directoryUnitPath } from "../../../../lib/paths";
import { STORAGE_KEYS } from "../../../../lib/storageKeys";
import { directoryApi, useDirectoryChange, useDirectoryGroup } from "../../../../queries/directory";
import { EMPTY_VALUE, formatDate } from "../../../../utils";
import { HeaderBreadcrumb } from "../../../app/HeaderBreadcrumb";
import { describeRemoveMember } from "../../confirmations";
import { GROUP_KIND_LABELS, GROUP_SCOPE_LABELS } from "../../lib/directoryForms";
import { TextFieldsDialog } from "../TextFieldsDialog";
import { DirectoryGate } from "../DirectoryGate";
import { useObjectActions } from "../ObjectActions";
import { ObjectPickerDialog } from "../ObjectDialogs";
import { RefTable } from "../RefTable";

const Group = ({ group, writable }: { group: DirectoryGroup; writable: boolean }) => {
    const back = useBackPath();
    const { confirm } = useConfirm();
    const { menuState, triggerRef, openMenu, closeMenu } = useActionMenu<string>();
    const [dialog, setDialog] = useState<"edit" | "members" | null>(null);

    const update = useDirectoryChange((changes: Record<string, string | null>) => directoryApi.updateGroup(group.guid, changes));
    const addMembers = useDirectoryChange((members: string[]) => directoryApi.addMembers(group.guid, members));
    const removeMember = useDirectoryChange((member: string) => directoryApi.removeMembers(group.guid, [member]));

    const actions = useObjectActions(
        { ...group, name: group.accountName, type: "group" },
        { afterDelete: ROUTES.directoryGroups, closeMenu },
    );

    useEscapeToLeave(back);

    const members = group.members ?? [];
    const requestRemove = (member: DirectoryRef) =>
        confirm({
            ...describeRemoveMember(member.name, group.accountName),
            onConfirm: async () => {
                await removeMember.mutateAsync(member.guid);
            },
        });

    const details: EntityDetail[] = [
        { label: "Description", value: group.description || EMPTY_VALUE, visibility: "always" },
        {
            label: "Location",
            value: (
                <Link to={directoryUnitPath(group.parentDn)} className={cn("rounded-sm hover:text-primary", FOCUS_RING)}>
                    {group.parentDn}
                </Link>
            ),
            visibility: "always",
        },
        { label: "E-mail", value: group.mail || EMPTY_VALUE },
        { label: "Created", value: formatDate(group.whenCreated) },
        { label: "Changed", value: formatDate(group.whenChanged) },
        { label: "SID", value: group.sid ?? EMPTY_VALUE, copyable: group.sid ?? undefined },
        { label: "GUID", value: group.guid, copyable: group.guid },
        { label: "Distinguished Name", value: group.dn, copyable: group.dn },
    ];

    return (
        <div className="space-y-6">
            <EntityHeader
                title={<HeaderBreadcrumb current={group.accountName}>{group.accountName}</HeaderBreadcrumb>}
                classNames={ENTITY_HEADER}
                meta={
                    <>
                        <Badge variant="neutral">{GROUP_SCOPE_LABELS[group.scope]}</Badge>
                        <Badge variant={group.kind === "security" ? "info" : "neutral"}>{GROUP_KIND_LABELS[group.kind]}</Badge>
                        {(group.protected || group.builtin) && <Badge variant="neutral">Protected</Badge>}
                    </>
                }
                details={details}
                persist={{ key: STORAGE_KEYS.directoryDetails, scope: "local" }}
                actions={
                    writable && (
                        <div className="relative">
                            <ActionButton icon={MoreVertical} aria-label="Group actions" onClick={(e) => openMenu(e, group.guid)} />
                            <ActionMenu
                                isOpen={menuState?.id === group.guid}
                                onClose={closeMenu}
                                anchor={menuState?.anchor ?? null}
                                triggerRef={triggerRef}
                            >
                                <MenuItem
                                    icon={Pencil}
                                    onClick={() => {
                                        closeMenu();
                                        setDialog("edit");
                                    }}
                                >
                                    Edit
                                </MenuItem>
                                {actions.menuItems}
                            </ActionMenu>
                        </div>
                    )
                }
            />

            <RefTable
                title={
                    <>
                        <Users size={18} className="text-text-muted" /> Members
                    </>
                }
                objects={members}
                searchable={members.length > 10}
                empty={{ icon: Users, title: "The group has no members" }}
                extraActions={
                    writable && (
                        <Button size="sm" icon={UserPlus} onClick={() => setDialog("members")}>
                            Add Members
                        </Button>
                    )
                }
                renderRowActions={
                    writable
                        ? (member) => (
                              <DataAction
                                  rowId={member.guid}
                                  actions={[{ tooltip: `Remove ${member.name}`, icon: X, onClick: () => requestRemove(member) }]}
                              />
                          )
                        : undefined
                }
            />

            {(group.memberOf?.length ?? 0) > 0 && (
                <RefTable
                    title={
                        <>
                            <Users size={18} className="text-text-muted" /> Member Of
                        </>
                    }
                    objects={group.memberOf ?? []}
                    empty={{ icon: Users, title: "Not a member of any group" }}
                />
            )}

            {dialog === "edit" && (
                <TextFieldsDialog
                    title={`Edit ${group.accountName}`}
                    fields={[
                        { key: "description", label: "Description", max: 1024 },
                        { key: "mail", label: "E-mail", type: "email", max: 256 },
                    ]}
                    values={{ description: group.description, mail: group.mail }}
                    onClose={() => setDialog(null)}
                    onSave={(changes) => update.mutateAsync(changes)}
                />
            )}
            {dialog === "members" && (
                <ObjectPickerDialog
                    title={`Add members to ${group.accountName}`}
                    types={["user", "group", "computer"]}
                    confirmLabel="Add"
                    excludeGuids={new Set([group.guid, ...members.map((member) => member.guid)])}
                    onClose={() => setDialog(null)}
                    onPick={(picked) => addMembers.mutateAsync(picked.map((object) => object.guid))}
                />
            )}
            {actions.dialogs}
        </div>
    );
};

const GroupPage = ({ writable }: { writable: boolean }) => {
    const { guid = "" } = useParams();
    const { data, isPending, error } = useDirectoryGroup(guid);

    if (!data) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 400)) throw new NotFoundError("group");
        if (error) return <QueryError title="Could not load the group" error={error} />;
        if (isPending) return <LoadingIndicator label="Loading group…" />;
        return null;
    }
    return <Group group={data} writable={writable} />;
};

/** `/directory/groups/:guid`: one group and its members. */
export const GroupDetail = () => <DirectoryGate>{({ writable }) => <GroupPage writable={writable} />}</DirectoryGate>;
