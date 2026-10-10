import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, FolderPlus, FolderTree, MoreVertical, Pencil } from "lucide-react";
import {
    ActionButton,
    ActionMenu,
    Alert,
    Badge,
    Button,
    Card,
    FOCUS_RING,
    Input,
    LoadingIndicator,
    MenuItem,
    Modal,
    cn,
    useActionMenu,
    usePersistentState,
} from "@stefgo/react-ui-components";
import { CreateOuSchema, parentDn as parentOf, rdnValue } from "@sadm/shared";
import { QueryError } from "../../../../components/QueryError";
import { useEntityForm } from "../../../../hooks/useEntityForm";
import { UNIT_PARAM, directoryUnitPath } from "../../../../lib/paths";
import { STORAGE_KEYS } from "../../../../lib/storageKeys";
import { directoryApi, useDirectoryChange, useDirectoryChildren, useDirectoryTree } from "../../../../queries/directory";
import { EMPTY_VALUE } from "../../../../utils";
import { OBJECT_TYPE_LABELS } from "../../lib/objectLabels";
import { orderUnits, unitTrail, type UnitNode } from "../../lib/unitTree";
import { DirectoryGate } from "../DirectoryGate";
import { useObjectActions } from "../ObjectActions";
import { ObjectIcon } from "../ObjectIcon";
import { RefTable } from "../RefTable";
import { TextFieldsDialog } from "../TextFieldsDialog";

const CREATE_FORM_ID = "directory-ou-form";

const NONE_CLOSED: string[] = [];

const CreateUnitDialog = ({ parent, onClose }: { parent: UnitNode; onClose: () => void }) => {
    const create = useDirectoryChange(directoryApi.createOu);
    const form = useEntityForm({
        initial: { name: "", description: "" },
        schema: CreateOuSchema,
        toInput: (draft) => ({
            parentDn: parent.dn,
            name: draft.name,
            description: draft.description.trim() === "" ? undefined : draft.description,
        }),
        fieldOf: (path) => (path[0] === "name" || path[0] === "description" ? path[0] : null),
    });

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={`New organizational unit in ${parent.name}`}
            closeOnOverlayClick={false}
            footer={
                <>
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button type="submit" form={CREATE_FORM_ID} variant="primary" disabled={!form.canSave} isLoading={form.isSaving}>
                        Create
                    </Button>
                </>
            }
        >
            <form
                id={CREATE_FORM_ID}
                className="space-y-4"
                onSubmit={async (event) => {
                    event.preventDefault();
                    if (await form.submit((input) => create.mutateAsync(input))) onClose();
                }}
            >
                {form.saveError && <Alert>{form.saveError}</Alert>}
                <Input label="Name" value={form.draft.name} onChange={(e) => form.set("name", e.target.value)} error={form.errors.name} autoFocus />
                <Input
                    label="Description"
                    value={form.draft.description}
                    onChange={(e) => form.set("description", e.target.value)}
                    error={form.errors.description}
                />
            </form>
        </Modal>
    );
};

/** The header of the open container: what it is, and -- for an organizational unit -- what can be done to it. */
const UnitHeader = ({ unit, units, writable }: { unit: UnitNode; units: UnitNode[]; writable: boolean }) => {
    const { menuState, triggerRef, openMenu, closeMenu } = useActionMenu<string>();
    const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
    const update = useDirectoryChange((changes: Record<string, string | null>) => directoryApi.updateOu(unit.guid, changes));
    const parent = unit.parentDn ?? parentOf(unit.dn) ?? "";
    const actions = useObjectActions(
        { guid: unit.guid, dn: unit.dn, parentDn: parent, cn: rdnValue(unit.dn) ?? unit.name, name: unit.name, type: unit.type, protected: unit.protected },
        { afterDelete: directoryUnitPath(parent), closeMenu },
    );
    const isUnit = unit.type === "ou";

    return (
        <Card padding="md">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-text-primary">
                        <ObjectIcon type={unit.type} size={18} />
                        <span className="truncate">{unit.name}</span>
                        <Badge variant="neutral">{OBJECT_TYPE_LABELS[unit.type]}</Badge>
                    </h2>
                    <p className="mt-1 truncate text-sm text-text-muted" title={unit.dn}>
                        {unitTrail(units, unit.dn)}
                    </p>
                    <p className="mt-2 text-sm text-text-primary">{unit.description || EMPTY_VALUE}</p>
                </div>
                {writable && (
                    <div className="flex shrink-0 items-center gap-2">
                        {/* An organizational unit can only be created in the domain or in another one. */}
                        {(isUnit || unit.type === "domain") && (
                            <Button size="sm" icon={FolderPlus} onClick={() => setDialog("create")}>
                                New Unit
                            </Button>
                        )}
                        {isUnit && (
                            <div className="relative">
                                <ActionButton icon={MoreVertical} aria-label="Organizational unit actions" onClick={(e) => openMenu(e, unit.guid)} />
                                <ActionMenu
                                    isOpen={menuState?.id === unit.guid}
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
                        )}
                    </div>
                )}
            </div>
            {dialog === "create" && <CreateUnitDialog parent={unit} onClose={() => setDialog(null)} />}
            {dialog === "edit" && (
                <TextFieldsDialog
                    title={`Edit ${unit.name}`}
                    fields={[{ key: "description", label: "Description", max: 1024 }]}
                    values={{ description: unit.description }}
                    onClose={() => setDialog(null)}
                    onSave={(changes) => update.mutateAsync(changes)}
                />
            )}
            {actions.dialogs}
        </Card>
    );
};

const Units = ({ writable }: { writable: boolean }) => {
    const { data, isPending, error } = useDirectoryTree();
    const [searchParams, setSearchParams] = useSearchParams();
    const [closed, setClosed] = usePersistentState<string[]>({
        persist: { key: STORAGE_KEYS.directoryUnitsClosed, scope: "local" },
        fallback: NONE_CLOSED,
        revive: (raw) => (Array.isArray(raw) && raw.every((item) => typeof item === "string") ? raw : undefined),
    });
    // The open container by its GUID as well: after a rename or a move its DN is another one,
    // and the address still names the old.
    const [lastGuid, setLastGuid] = useState<string | null>(null);

    const units = useMemo(() => orderUnits(data?.containers ?? []), [data]);
    const requested = searchParams.get(UNIT_PARAM);
    // The address names a container. One it no longer names is looked for by the GUID it had;
    // one that is gone altogether falls back to the domain.
    const selected =
        units.find((unit) => unit.dn.toLowerCase() === requested?.toLowerCase()) ??
        units.find((unit) => unit.guid === lastGuid) ??
        units[0] ??
        null;
    const children = useDirectoryChildren(selected?.dn ?? null);

    const select = (unit: UnitNode) => {
        setLastGuid(unit.guid);
        setSearchParams({ [UNIT_PARAM]: unit.dn }, { replace: true });
    };

    // Brings the address back in line with the container that is shown.
    const shownDn = selected?.dn ?? null;
    useEffect(() => {
        if (shownDn && requested && shownDn.toLowerCase() !== requested.toLowerCase()) {
            setSearchParams({ [UNIT_PARAM]: shownDn }, { replace: true });
        }
    }, [shownDn, requested, setSearchParams]);

    // A container is hidden while any container above it is closed.
    const closedSet = new Set(closed.map((dn) => dn.toLowerCase()));
    const visible = units.filter((unit) => {
        let parent = unit.parentDn;
        while (parent) {
            if (closedSet.has(parent.toLowerCase())) return false;
            parent = units.find((other) => other.dn.toLowerCase() === parent!.toLowerCase())?.parentDn ?? null;
        }
        return true;
    });
    const toggle = (dn: string) =>
        setClosed(closedSet.has(dn.toLowerCase()) ? closed.filter((other) => other.toLowerCase() !== dn.toLowerCase()) : [...closed, dn]);

    if (error && !data) return <QueryError title="Could not load the organizational units" error={error} />;
    if (isPending || !selected) return <LoadingIndicator label="Loading organizational units…" />;

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <Card
                title={
                    <span className="flex items-center gap-2">
                        <FolderTree size={18} className="text-text-muted" /> Containers
                    </span>
                }
                titleAs="h2"
            >
                <ul role="tree" aria-label="Containers of the domain" className="py-2">
                    {visible.map((unit) => {
                        const isSelected = unit.dn === selected.dn;
                        const isClosed = closedSet.has(unit.dn.toLowerCase());
                        return (
                            <li
                                key={unit.dn}
                                role="treeitem"
                                aria-selected={isSelected}
                                aria-expanded={unit.hasChildren ? !isClosed : undefined}
                                className="flex items-center"
                                style={{ paddingLeft: `${0.5 + unit.depth * 1.25}rem` }}
                            >
                                {unit.hasChildren ? (
                                    <button
                                        type="button"
                                        aria-label={isClosed ? `Open ${unit.name}` : `Close ${unit.name}`}
                                        onClick={() => toggle(unit.dn)}
                                        className={cn("rounded p-1 text-text-muted hover:text-text-primary", FOCUS_RING)}
                                    >
                                        {isClosed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                    </button>
                                ) : (
                                    <span className="w-[22px]" />
                                )}
                                <button
                                    type="button"
                                    onClick={() => select(unit)}
                                    className={cn(
                                        "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                                        isSelected ? "bg-hover font-medium text-text-primary" : "text-text-secondary hover:bg-hover",
                                        FOCUS_RING,
                                    )}
                                >
                                    <ObjectIcon type={unit.type} className={cn("shrink-0", isSelected ? "text-primary" : "text-text-muted")} />
                                    <span className="truncate">{unit.name}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </Card>

            <div className="min-w-0 space-y-6">
                <UnitHeader key={selected.guid} unit={selected} units={units} writable={writable} />
                <RefTable
                    title={`In ${selected.name}`}
                    objects={children.data ?? []}
                    isLoading={children.isPending}
                    searchable
                    empty={{
                        icon: FolderTree,
                        title: children.error ? "Could not load what is in this container" : "This container is empty",
                        description: children.error instanceof Error ? children.error.message : undefined,
                    }}
                />
            </div>
        </div>
    );
};

/** `/directory/units`: the containers of the domain as a tree, and what lives in the one that is open. */
export const UnitBrowser = () => <DirectoryGate>{({ writable }) => <Units writable={writable} />}</DirectoryGate>;
