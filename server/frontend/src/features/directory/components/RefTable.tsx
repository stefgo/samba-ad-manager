import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { DataMultiView, EmptyState, FOCUS_RING, cn, actionsColumn, type DataColumnDef } from "@stefgo/react-ui-components";
import type { LucideIcon } from "lucide-react";
import type { DirectoryRef } from "@sadm/shared";
import { directoryObjectPath } from "../../../lib/paths";
import { EMPTY_VALUE } from "../../../utils";
import { OBJECT_TYPE_LABELS } from "../lib/objectLabels";
import { ObjectIcon } from "./ObjectIcon";

interface RefTableProps {
    title: ReactNode;
    objects: DirectoryRef[];
    isLoading?: boolean;
    /** What an empty table says. */
    empty: { icon: LucideIcon; title: string; description?: string };
    extraActions?: ReactNode;
    renderRowActions?: (object: DirectoryRef) => ReactNode;
    searchable?: boolean;
}

const matches = (object: DirectoryRef, query: string) => {
    const q = query.toLowerCase();
    return object.name.toLowerCase().includes(q) || (object.detail ?? "").toLowerCase().includes(q);
};

/**
 * A list of directory objects by name: the groups an account is in, the members of a group,
 * what lives in a container. Each name leads to the object's own page.
 */
export const RefTable = ({ title, objects, isLoading, empty, extraActions, renderRowActions, searchable }: RefTableProps) => {
    const columns: DataColumnDef<DirectoryRef>[] = [
        {
            header: "Name",
            sortable: true,
            sortValue: (object) => object.name,
            list: { label: null },
            render: (object) => {
                const to = directoryObjectPath(object);
                const label = (
                    <span className="flex min-w-0 items-center gap-2">
                        <ObjectIcon type={object.type} />
                        <span className="truncate text-sm font-medium text-text-primary">{object.name}</span>
                    </span>
                );
                return to ? (
                    <Link to={to} className={cn("block rounded-sm hover:text-primary", FOCUS_RING)} onClick={(e) => e.stopPropagation()}>
                        {label}
                    </Link>
                ) : (
                    label
                );
            },
        },
        {
            header: "Type",
            sortable: true,
            sortValue: (object) => object.type,
            render: (object) => <span className="text-sm text-text-primary">{OBJECT_TYPE_LABELS[object.type] ?? object.type}</span>,
        },
        {
            header: "Description",
            render: (object) => <span className="text-sm text-text-muted">{object.detail || EMPTY_VALUE}</span>,
        },
        ...(renderRowActions ? [actionsColumn<DirectoryRef>((object) => renderRowActions(object))] : []),
    ];

    return (
        <DataMultiView
            title={title}
            extraActions={extraActions}
            data={objects}
            columns={columns}
            keyField="guid"
            isLoading={isLoading}
            sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
            searchable={searchable}
            searchPlaceholder="Search…"
            searchFilter={matches}
            emptyMessage={<EmptyState icon={empty.icon} title={empty.title} description={empty.description} />}
        />
    );
};
