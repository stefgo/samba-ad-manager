import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
    ChevronRight,
    ChevronDown,
    Activity,
    MoreVertical,
    Trash2,
    Eye,
    Server,
    Tag,
    type LucideIcon,
} from "lucide-react";
import {
    ActionButton,
    ActionMenu,
    Button,
    DataAction,
    DataMultiView,
    DataTableDef,
    EmptyState,
    FOCUS_RING,
    Select,
    cn,
    useActionMenu,
    useConfirm,
    useToast,
    MenuItem,
    PAGE_SIZE,
    listPagination,
} from "@stefgo/react-ui-components";
import { ACTIVITY_LEVELS, ActivityLevel, ActivityRecord, activityDetail, activityMessage } from "@sadm/shared";
import { unseenTone } from "../../../lib/cacheUpdates";
import { useActivity, useClearActivity, useMarkActivitySeen } from "../../../queries/activity";
import { useClients } from "../../../queries/clients";
import { QueryError } from "../../../components/QueryError";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { ActivityGroupSteps } from "./ActivityGroupSteps";
import { ActivityLevelIcon } from "./ActivityLevelIcon";
import { ActivityGroup, groupActivity } from "../lib/groupActivity";
import { type ActivityLinks, activityLinks } from "../lib/activityLinks";
import { describeDeleteAllActivity } from "../confirmations";
import { clientName, getErrorMessage } from "../../../utils";
import { RelativeTime } from "../../../components/RelativeTime";
import { STORAGE_KEYS } from "../../../lib/storageKeys";

const CHIP = "inline-flex items-center gap-1 text-[11px] bg-hover px-1.5 py-0.5 rounded text-text-muted";

/** One thing an event is about. With a target it is the way to that thing's page. */
function SubjectChip({
    icon: Icon,
    to,
    mono,
    children,
}: {
    icon?: LucideIcon;
    to?: string;
    mono?: boolean;
    children: ReactNode;
}) {
    const content = (
        <>
            {Icon && <Icon size={10} />} {children}
        </>
    );
    if (!to) return <span className={cn(CHIP, mono && "font-mono")}>{content}</span>;
    return (
        <Link to={to} className={cn(CHIP, "hover:text-text-primary hover:underline", FOCUS_RING)}>
            {content}
        </Link>
    );
}

/**
 * What an event is about, and last its kind: the name a webhook filter and `{{event.kind}}`
 * know it by, which the sentence above does not show. The domain controller leads to its
 * page; the object and the kind have no page and stay text.
 */
function SubjectBadges({ event, links }: { event: ActivityRecord; links: ActivityLinks }) {
    const subject = event.subject;
    const clientName = typeof event.data?.clientName === "string" ? event.data.clientName : null;
    return (
        <div className="flex flex-wrap gap-1 mt-1">
            {clientName && <SubjectChip icon={Server} to={links.client}>{clientName}</SubjectChip>}
            {subject?.name && <SubjectChip>{subject.name}</SubjectChip>}
            <SubjectChip icon={Tag}>{event.kind}</SubjectChip>
        </div>
    );
}

/**
 * A minimum, so the label says so: "≥ info" is info and everything above it. The most
 * severe level has nothing above it.
 */
const levelLabel = (level: ActivityLevel): string =>
    level === ACTIVITY_LEVELS[ACTIVITY_LEVELS.length - 1] ? level : `≥ ${level}`;

/**
 * What the search box matches an event against: the sentence a reader sees, the kind it was
 * phrased from, and the domain controller and object it is about. A group matches when
 * any of its events does, so a step is found under the operation it belongs to.
 */
function searchText(event: ActivityRecord): string {
    const subject = event.subject;
    return [
        activityMessage(event),
        activityDetail(event),
        event.kind,
        typeof event.data?.clientName === "string" ? event.data.clientName : null,
        subject?.instanceName,
        subject?.vrid !== undefined ? `vrid ${subject.vrid}` : null,
        subject?.interface,
    ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
}

/** A group matches when any of its events does, so a step is found under its operation. */
const matchesSearch = (group: ActivityGroup, query: string) => {
    const q = query.toLowerCase();
    return [group.head, ...group.members].some((event) => searchText(event).includes(q));
};

interface ActivityViewProps {
    /**
     * The level the filter opens on, in place of the one worked out from the unseen events.
     * The dashboard's Errors / Warnings card passes "warning", so the list shows what the card
     * counts.
     */
    initialLevel?: ActivityLevel;
}

/**
 * The activity list: structured events, not messages written for the reader.
 *
 * Two things follow from that and are visible here: the text of a row is written in
 * `activityText` out of `kind` and `data`, not taken from the event, and a multi-step
 * operation is a group of full events rather than one entry with a list of sentences
 * attached. The level filter works on the field itself, so "warning and above" means exactly
 * that; the search box covers everything a reader would look for by name.
 */
export function ActivityView({ initialLevel }: ActivityViewProps = {}) {
    const { events, error } = useActivity();
    const { mutate: markSeen } = useMarkActivitySeen();
    const { show } = useToast();
    // The rows turn seen at once and go back if the server refuses; the toast says why they did.
    const markManySeen = (ids: string[]) => {
        if (ids.length === 0) return;
        markSeen(ids, {
            onError: (e) =>
                show({ variant: "error", title: "Could not mark the events as seen", description: getErrorMessage(e) }),
        });
    };
    const clearActivity = useClearActivity();
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const { confirm } = useConfirm();
    const { menuState, triggerRef, openMenu, closeMenu } = useActionMenu<string>();
    const { clients } = useClients();
    const clientIds = useMemo(() => new Set(clients.map((c) => c.id)), [clients]);
    // A minimum, not an exact match: "info" shows everything but the trace level. The page
    // opens on what needs a look: "error" while an error is unseen, else "warning" while a
    // warning is, else "info". That start is fixed once the list is known, so marking a row
    // seen does not pull the filter out from under the reader; until then it follows the list.
    // A caller's `initialLevel` stands in for that start.
    const [chosenLevel, setChosenLevel] = useState<ActivityLevel | null>(initialLevel ?? null);
    const startLevel: ActivityLevel = unseenTone(events) ?? "info";
    if (chosenLevel === null && events.length > 0) {
        setChosenLevel(startLevel);
    }
    const levelFilter = chosenLevel ?? startLevel;
    // Whether seen entries are listed at all. Under "unseen" a row leaves the list as soon as
    // it is marked seen, which is the point: what is left is what has not been looked at.
    const [seenFilter, setSeenFilter] = useState<"all" | "unseen">("unseen");
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    // Events recorded before the server stored `clientName` with them name no host. The
    // client list still knows it as long as the host exists, so the name is filled in here.
    const named = useMemo(() => {
        const names = new Map(clients.map((c) => [c.id, clientName(c)]));
        return events.map((event) => {
            if (!event.clientId || typeof event.data?.clientName === "string") return event;
            const clientName = names.get(event.clientId);
            return clientName ? { ...event, data: { ...event.data, clientName } } : event;
        });
    }, [events, clients]);

    const groups = useMemo(() => groupActivity(named), [named]);

    const filtered = useMemo(
        () =>
            groups.filter((group) => {
                if (ACTIVITY_LEVELS.indexOf(group.level) < ACTIVITY_LEVELS.indexOf(levelFilter)) {
                    return false;
                }
                return seenFilter !== "unseen" || group.unseen;
            }),
        [groups, levelFilter, seenFilter],
    );
    // The search is the view's (`searchFilter`), so it can say that nothing matched. What is
    // on screen is needed here as well, for "Mark as seen".
    const shown = useMemo(
        () => (searchQuery ? filtered.filter((group) => matchesSearch(group, searchQuery)) : filtered),
        [filtered, searchQuery],
    );

    const toggleExpand = (id: string) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    /**
     * A row is one group, so seeing it means seeing everything under it -- in one request,
     * and only for the events that are not seen yet.
     */
    const handleMarkSeen = (group: ActivityGroup) => {
        markManySeen([group.head, ...group.members].filter((e) => !e.seen).map((e) => e.id));
    };

    const tableDef: DataTableDef<ActivityGroup>[] = [
        {
            tableHeader: "",
            tableHeaderClassName: "px-0 pl-6 w-px",
            // The row grows when a group is expanded, so the icon is pinned to the top line
            // of the message instead of floating in the middle of the row.
            tableCellClassName: "px-0 pl-6 w-px align-top pt-2.5",
            tableItemRender: (g) => <ActivityLevelIcon level={g.level} />,
        },
        {
            tableHeader: "Message",
            tableItemRender: (g) => {
                const isExpanded = expandedIds.has(g.head.id);
                const detail = activityDetail(g.head);
                const expandable = !!detail || g.members.length > 0;
                return (
                    <div className={`flex items-start gap-2 w-full ${g.unseen ? "" : "opacity-60"}`}>
                        <div className="mt-0.5 shrink-0 w-[14px]">
                            {expandable && (
                                <ActionButton
                                    icon={isExpanded ? ChevronDown : ChevronRight}
                                    size="sm"
                                    tooltip={isExpanded ? "Collapse" : "Expand"}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleExpand(g.head.id);
                                    }}
                                />
                            )}
                        </div>
                        <div className="w-full min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                                <p className={`text-sm text-text-primary truncate ${g.unseen ? "font-medium" : ""}`}>
                                    {activityMessage(g.head)}
                                </p>
                                {g.members.length > 0 && (
                                    <span className="shrink-0 text-[11px] bg-hover px-1.5 py-0.5 rounded text-text-muted">
                                        {g.members.length} step{g.members.length === 1 ? "" : "s"}
                                    </span>
                                )}
                            </div>
                            {isExpanded && detail && (
                                <p className="mt-1 text-xs text-text-muted whitespace-pre-wrap break-words">
                                    {detail}
                                </p>
                            )}
                            {isExpanded && g.members.length > 0 && (
                                <ActivityGroupSteps members={g.members} />
                            )}
                            <SubjectBadges event={g.head} links={activityLinks(g.head, clientIds)} />
                        </div>
                    </div>
                );
            },
        },
        {
            tableHeader: "Time",
            tableHeaderClassName: "w-px whitespace-nowrap",
            tableCellClassName: "w-px whitespace-nowrap text-sm text-text-muted",
            sortable: true,
            sortValue: (g) => new Date(g.head.occurredAt).getTime(),
            tableItemRender: (g) => <RelativeTime date={g.head.occurredAt} seconds />,
        },
        {
            tableHeader: "Actions",
            tableHeaderClassName: "w-px text-center",
            tableCellClassName: "w-px content-center",
            // A row that has been seen has nothing left to do: no button that does nothing.
            tableItemRender: (g) =>
                g.unseen && (
                    <DataAction
                        rowId={g.head.id}
                        actions={[
                            {
                                icon: Eye,
                                onClick: () => handleMarkSeen(g),
                                tooltip: "Mark as seen",
                                color: "blue" as const,
                            },
                        ]}
                    />
                ),
        },
    ];

    // "Mark as seen" acts on what the level filter and the search leave on screen, every page
    // of it -- not on events the reader has not been shown.
    const unseenShown = shown
        .flatMap((g) => [g.head, ...g.members])
        .filter((e) => !e.seen)
        .map((e) => e.id);

    // Styled like the search pill they sit next to rather than like form fields: same height,
    // radius, border and background, so the bar reads as one row of controls.
    const pillSelect = {
        select: "py-1 pl-3 pr-9 rounded-full border-border bg-app-bg text-sm",
    };
    const filterSelects = (
        <div className="flex flex-wrap items-center gap-2">
            <Select
                aria-label="Filter by seen state"
                fullWidth={false}
                classNames={pillSelect}
                value={seenFilter}
                onChange={(e) => setSeenFilter(e.target.value as "all" | "unseen")}
                options={[
                    { value: "all", label: "Show: all" },
                    { value: "unseen", label: "Show: unseen" },
                ]}
            />
            <Select
                aria-label="Filter by level"
                fullWidth={false}
                classNames={pillSelect}
                value={levelFilter}
                onChange={(e) => setChosenLevel(e.target.value as ActivityLevel)}
                options={ACTIVITY_LEVELS.map((level) => ({ value: level, label: levelLabel(level) }))}
            />
        </div>
    );

    const extraActions = (
        <div className="flex flex-wrap items-center gap-2">
            {unseenShown.length > 0 && (
                <Button variant="secondary" size="sm" onClick={() => markManySeen(unseenShown)}>
                    Mark as seen
                </Button>
            )}
            {groups.length > 0 && (
                <div className="relative">
                    <ActionButton
                        icon={MoreVertical}
                        aria-label="Activity actions"
                        onClick={(e) => openMenu(e, "activity")}
                    />
                    <ActionMenu
                        isOpen={menuState?.id === "activity"}
                        onClose={closeMenu}
                        anchor={menuState?.anchor ?? null}
                        triggerRef={triggerRef}
                    >
                        <MenuItem
                            icon={Trash2}
                            variant="danger"
                            onClick={() =>
                                confirm({ ...describeDeleteAllActivity(events.length), onConfirm: () => clearActivity.mutateAsync() })
                            }
                        >
                            Delete all
                        </MenuItem>
                    </ActionMenu>
                </div>
            )}
        </div>
    );

    if (error) return <QueryError title="Could not load the activity" error={error} />;

    return (
        <DataMultiView<ActivityGroup>
            title={
                <>
                    <Activity size={18} className="text-text-muted" /> Activity
                </>
            }
            viewMode={{ persist: { key: STORAGE_KEYS.activityView, scope: "local" } }}
            data={filtered}
            tableDef={tableDef}
            keyField={(g) => g.head.id}
            // Column 2 is the time. Column 3 is the action column, which has no sort value.
            sort={{ defaultValue: [{ colIndex: 2, direction: "desc" }] }}
            // The level and the seen filter are no search, so the view takes what they leave
            // empty for an empty list. Only a list without any event is one.
            emptyMessage={
                events.length === 0 ? (
                    <EmptyState
                        icon={Activity}
                        title="Nothing has happened yet"
                        description="What the domain controllers and the server report is recorded here."
                    />
                ) : (
                    "No events match these filters."
                )
            }
            noResultsMessage={`No events match “${searchQuery}”.`}
            pagination={listPagination(PAGE_SIZE.page)}
            searchable
            searchPlaceholder="Search activity…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            searchFilter={matchesSearch}
            searchActions={filterSelects}
            extraActions={extraActions}
            classNames={{ table: { table: "w-full" } }}
        />
    );
}
