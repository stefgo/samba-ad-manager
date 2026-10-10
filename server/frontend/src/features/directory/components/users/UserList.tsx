import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, User } from "lucide-react";
import {
    Button,
    DataMultiView,
    EmptyState,
    PAGE_SIZE,
    Select,
    listGroups,
    listPagination,
    type DataColumnDef,
} from "@stefgo/react-ui-components";
import type { DirectoryUser } from "@sadm/shared";
import { QueryError } from "../../../../components/QueryError";
import { RelativeTime } from "../../../../components/RelativeTime";
import { useSearchQueryParam } from "../../../../hooks/useSearchQueryParam";
import { paths } from "../../../../lib/paths";
import { STORAGE_KEYS } from "../../../../lib/storageKeys";
import { useDirectoryTree, useDirectoryUsers } from "../../../../queries/directory";
import { EMPTY_VALUE } from "../../../../utils";
import { orderUnits, unitTrail } from "../../lib/unitTree";
import { DirectoryGate } from "../DirectoryGate";
import { UserFormDialog } from "./UserFormDialog";
import { UserStatus } from "./UserStatus";

const NO_USERS: DirectoryUser[] = [];

type StateFilter = "all" | "enabled" | "disabled" | "locked";

const FILTERS: { value: StateFilter; label: string }[] = [
    { value: "all", label: "All accounts" },
    { value: "enabled", label: "Enabled" },
    { value: "disabled", label: "Disabled" },
    { value: "locked", label: "Locked out" },
];

const inState = (user: DirectoryUser, filter: StateFilter): boolean =>
    filter === "all" ||
    (filter === "enabled" && user.enabled) ||
    (filter === "disabled" && !user.enabled) ||
    (filter === "locked" && user.lockedOut);

const matchesSearch = (user: DirectoryUser, query: string) => {
    const q = query.toLowerCase();
    return [user.accountName, user.displayName, user.mail, user.description, user.userPrincipalName].some((value) =>
        (value ?? "").toLowerCase().includes(q),
    );
};

const Users = ({ writable }: { writable: boolean }) => {
    const navigate = useNavigate();
    const { data, isPending, error } = useDirectoryUsers();
    const { data: tree } = useDirectoryTree();
    const [searchQuery, setSearchQuery] = useSearchQueryParam();
    const [filter, setFilter] = useState<StateFilter>("all");
    const [isCreating, setIsCreating] = useState(false);

    const units = useMemo(() => orderUnits(tree?.containers ?? []), [tree]);
    const users = useMemo(() => (data ?? NO_USERS).filter((user) => inState(user, filter)), [data, filter]);
    // New users go where the directory puts them by default, unless there is no such place.
    const defaultParent = units.find((unit) => unit.name === "Users" && unit.type === "container")?.dn ?? "";

    // Instead of the list: an empty one would say the directory has no users.
    if (error && data === undefined) return <QueryError title="Could not load the users" error={error} />;

    const columns: DataColumnDef<DirectoryUser>[] = [
        {
            header: "Logon Name",
            sortable: true,
            sortValue: (user) => user.accountName,
            list: { label: null },
            render: (user) => (
                <span className={`flex items-center gap-2 text-sm font-medium text-text-primary ${user.enabled ? "" : "opacity-60"}`}>
                    <User size={16} className="shrink-0 text-text-muted" />
                    {user.accountName}
                </span>
            ),
        },
        {
            header: "Name",
            sortable: true,
            sortValue: (user) => user.displayName ?? "",
            render: (user) => <span className="text-sm text-text-primary">{user.displayName || EMPTY_VALUE}</span>,
        },
        {
            header: "E-mail",
            table: false,
            render: (user) => <span className="text-sm text-text-primary">{user.mail || EMPTY_VALUE}</span>,
        },
        {
            header: "Location",
            sortable: true,
            sortValue: (user) => unitTrail(units, user.parentDn),
            render: (user) => <span className="text-sm text-text-muted">{unitTrail(units, user.parentDn)}</span>,
        },
        {
            header: "Last Logon",
            table: { cellClassName: "whitespace-nowrap" },
            sortable: true,
            sortValue: (user) => user.lastLogon ?? "",
            render: (user) => (
                <span className="text-sm text-text-muted">{user.lastLogon ? <RelativeTime date={user.lastLogon} /> : "Never"}</span>
            ),
        },
        { header: "Status", render: (user) => <UserStatus user={user} /> },
    ];

    return (
        <>
            <DataMultiView
                title={
                    <>
                        <User size={18} className="text-text-muted" /> Users
                    </>
                }
                extraActions={
                    writable && (
                        <Button size="sm" icon={Plus} onClick={() => setIsCreating(true)}>
                            New User
                        </Button>
                    )
                }
                data={users}
                columns={columns}
                listGroups={listGroups()}
                keyField="guid"
                isLoading={isPending}
                loadingMessage="Loading users…"
                sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
                viewMode={{ persist: { key: STORAGE_KEYS.directoryUsersView, scope: "local" } }}
                searchable
                searchPlaceholder="Search logon name, name, e-mail or description…"
                search={{ value: searchQuery, onChange: setSearchQuery }}
                searchFilter={matchesSearch}
                searchActions={
                    <Select
                        aria-label="Filter by state"
                        fullWidth={false}
                        value={filter}
                        onChange={(event) => setFilter(event.target.value as StateFilter)}
                        options={FILTERS}
                    />
                }
                noResultsMessage={`No users match “${searchQuery}”.`}
                emptyMessage={
                    <EmptyState
                        icon={User}
                        title={filter === "all" ? "The directory has no users" : "No user is in this state"}
                        description={filter === "all" ? undefined : "Choose another filter to see the others."}
                    />
                }
                onRowClick={(user) => navigate(paths.directoryUser(user.guid))}
                pagination={listPagination(PAGE_SIZE.page)}
            />
            {isCreating && (
                <UserFormDialog
                    user={null}
                    defaultParentDn={defaultParent}
                    onClose={() => setIsCreating(false)}
                    onCreated={(guid) => navigate(paths.directoryUser(guid))}
                />
            )}
        </>
    );
};

/** `/directory/users`: every user account of the domain. */
export const UserList = () => <DirectoryGate>{({ writable }) => <Users writable={writable} />}</DirectoryGate>;
