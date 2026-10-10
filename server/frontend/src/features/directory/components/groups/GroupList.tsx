import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Users } from "lucide-react";
import {
    Badge,
    Button,
    DataMultiView,
    EmptyState,
    PAGE_SIZE,
    Select,
    listGroups,
    listPagination,
    type DataColumnDef,
} from "@stefgo/react-ui-components";
import type { DirectoryGroup } from "@sadm/shared";
import { QueryError } from "../../../../components/QueryError";
import { useSearchQueryParam } from "../../../../hooks/useSearchQueryParam";
import { paths } from "../../../../lib/paths";
import { STORAGE_KEYS } from "../../../../lib/storageKeys";
import { useDirectoryGroups, useDirectoryTree } from "../../../../queries/directory";
import { EMPTY_VALUE } from "../../../../utils";
import { GROUP_KIND_LABELS, GROUP_SCOPE_LABELS } from "../../lib/directoryForms";
import { orderUnits, unitTrail } from "../../lib/unitTree";
import { DirectoryGate } from "../DirectoryGate";
import { GroupFormDialog } from "./GroupFormDialog";

const NO_GROUPS: DirectoryGroup[] = [];

type OriginFilter = "own" | "all";

const matchesSearch = (group: DirectoryGroup, query: string) => {
    const q = query.toLowerCase();
    return [group.accountName, group.description, group.mail].some((value) => (value ?? "").toLowerCase().includes(q));
};

const Groups = ({ writable }: { writable: boolean }) => {
    const navigate = useNavigate();
    const { data, isPending, error } = useDirectoryGroups();
    const { data: tree } = useDirectoryTree();
    const [searchQuery, setSearchQuery] = useSearchQueryParam();
    // A fresh domain has some forty groups of its own; the ones somebody made are the ones looked for.
    const [origin, setOrigin] = useState<OriginFilter>("all");
    const [isCreating, setIsCreating] = useState(false);

    const units = useMemo(() => orderUnits(tree?.containers ?? []), [tree]);
    const groups = useMemo(
        () => (data ?? NO_GROUPS).filter((group) => origin === "all" || (!group.protected && !group.builtin)),
        [data, origin],
    );
    const defaultParent = units.find((unit) => unit.name === "Users" && unit.type === "container")?.dn ?? "";

    if (error && data === undefined) return <QueryError title="Could not load the groups" error={error} />;

    const columns: DataColumnDef<DirectoryGroup>[] = [
        {
            header: "Name",
            sortable: true,
            sortValue: (group) => group.accountName,
            list: { label: null },
            render: (group) => (
                <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Users size={16} className="shrink-0 text-text-muted" />
                    {group.accountName}
                </span>
            ),
        },
        {
            header: "Description",
            render: (group) => <span className="text-sm text-text-muted">{group.description || EMPTY_VALUE}</span>,
        },
        {
            header: "Scope",
            sortable: true,
            sortValue: (group) => group.scope,
            render: (group) => (
                <span className="flex flex-wrap gap-1">
                    <Badge variant="neutral">{GROUP_SCOPE_LABELS[group.scope]}</Badge>
                    {group.kind === "distribution" && <Badge variant="info">{GROUP_KIND_LABELS.distribution}</Badge>}
                </span>
            ),
        },
        {
            header: "Members",
            sortable: true,
            sortValue: (group) => group.memberCount,
            render: (group) => <span className="text-sm text-text-primary">{group.memberCount}</span>,
        },
        {
            header: "Location",
            sortable: true,
            sortValue: (group) => unitTrail(units, group.parentDn),
            render: (group) => <span className="text-sm text-text-muted">{unitTrail(units, group.parentDn)}</span>,
        },
    ];

    return (
        <>
            <DataMultiView
                title={
                    <>
                        <Users size={18} className="text-text-muted" /> Groups
                    </>
                }
                extraActions={
                    writable && (
                        <Button size="sm" icon={Plus} onClick={() => setIsCreating(true)}>
                            New Group
                        </Button>
                    )
                }
                data={groups}
                columns={columns}
                listGroups={listGroups()}
                keyField="guid"
                isLoading={isPending}
                loadingMessage="Loading groups…"
                sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
                viewMode={{ persist: { key: STORAGE_KEYS.directoryGroupsView, scope: "local" } }}
                searchable
                searchPlaceholder="Search name, description or e-mail…"
                search={{ value: searchQuery, onChange: setSearchQuery }}
                searchFilter={matchesSearch}
                searchActions={
                    <Select
                        aria-label="Filter by origin"
                        fullWidth={false}
                        value={origin}
                        onChange={(event) => setOrigin(event.target.value as OriginFilter)}
                        options={[
                            { value: "all", label: "All groups" },
                            { value: "own", label: "Without the directory's own" },
                        ]}
                    />
                }
                noResultsMessage={`No groups match “${searchQuery}”.`}
                emptyMessage={
                    <EmptyState
                        icon={Users}
                        title={origin === "all" ? "The directory has no groups" : "No group has been created yet"}
                        description={origin === "all" ? undefined : "The directory's own groups are hidden by the filter."}
                    />
                }
                onRowClick={(group) => navigate(paths.directoryGroup(group.guid))}
                pagination={listPagination(PAGE_SIZE.page)}
            />
            {isCreating && (
                <GroupFormDialog
                    defaultParentDn={defaultParent}
                    onClose={() => setIsCreating(false)}
                    onCreated={(guid) => navigate(paths.directoryGroup(guid))}
                />
            )}
        </>
    );
};

/** `/directory/groups`: every group of the domain. */
export const GroupList = () => <DirectoryGate>{({ writable }) => <Groups writable={writable} />}</DirectoryGate>;
