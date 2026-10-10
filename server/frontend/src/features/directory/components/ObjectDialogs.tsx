import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Alert, Button, Checkbox, Input, Modal } from "@stefgo/react-ui-components";
import { RenameObjectSchema, SetPasswordSchema, isDnWithin, type DirectoryRef, type SetPassword } from "@sadm/shared";
import { useEntityForm } from "../../../hooks/useEntityForm";
import { searchDirectory } from "../../../queries/directory";
import { getErrorMessage } from "../../../utils";
import { EMPTY_PASSWORD_DRAFT, passwordFieldOf, passwordRules } from "../lib/directoryForms";
import { ContainerSelect } from "./ContainerSelect";
import { ObjectIcon } from "./ObjectIcon";

/** A dialog that runs one request and closes when it went through; a refusal stays in it. */
function useDialogAction(onClose: () => void) {
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const run = async (work: () => Promise<unknown>) => {
        setIsRunning(true);
        setError(null);
        try {
            await work();
            onClose();
        } catch (e) {
            setError(getErrorMessage(e));
        } finally {
            setIsRunning(false);
        }
    };
    return { isRunning, error, run, clearError: () => setError(null) };
}

// ── Move ─────────────────────────────────────────────────────────────────────

interface MoveDialogProps {
    /** What is moved: its name for the title, and where it is now. */
    object: { name: string; dn: string; parentDn: string; type: string };
    onClose: () => void;
    onMove: (parentDn: string) => Promise<unknown>;
}

/** Moves an object into another container. Mounted only while open. */
export const MoveDialog = ({ object, onClose, onMove }: MoveDialogProps) => {
    const [target, setTarget] = useState("");
    const { isRunning, error, run, clearError } = useDialogAction(onClose);
    const formId = "directory-move-form";

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={`Move ${object.name}`}
            closeOnOverlayClick={false}
            footer={
                <>
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button type="submit" form={formId} variant="primary" disabled={!target} isLoading={isRunning}>
                        Move
                    </Button>
                </>
            }
        >
            <form
                id={formId}
                className="space-y-4"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (target) void run(() => onMove(target));
                }}
            >
                {error && <Alert>{error}</Alert>}
                <ContainerSelect
                    label="Move to"
                    value={target}
                    onChange={(dn) => {
                        setTarget(dn);
                        clearError();
                    }}
                    // Where it is already, and -- for an organizational unit -- itself and below.
                    exclude={(dn) => dn.toLowerCase() === object.parentDn.toLowerCase() || isDnWithin(dn, object.dn)}
                    hint="Group policies linked to the new place apply from then on."
                />
            </form>
        </Modal>
    );
};

// ── Rename ───────────────────────────────────────────────────────────────────

interface RenameDialogProps {
    object: { name: string; cn: string; type: string };
    onClose: () => void;
    onRename: (name: string) => Promise<unknown>;
}

/** Renames an object within its container. For an account that is its common name, not its logon name. */
export const RenameDialog = ({ object, onClose, onRename }: RenameDialogProps) => {
    const form = useEntityForm({
        initial: { name: object.cn },
        schema: RenameObjectSchema,
        toInput: (draft) => draft,
        fieldOf: (path) => (path[0] === "name" ? "name" : null),
    });
    const formId = "directory-rename-form";
    const isAccount = object.type === "user" || object.type === "group" || object.type === "computer";

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={`Rename ${object.name}`}
            closeOnOverlayClick={false}
            footer={
                <>
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button type="submit" form={formId} variant="primary" disabled={!form.canSave} isLoading={form.isSaving}>
                        Rename
                    </Button>
                </>
            }
        >
            <form
                id={formId}
                className="space-y-4"
                onSubmit={async (event) => {
                    event.preventDefault();
                    if (await form.submit((input) => onRename(input.name))) onClose();
                }}
            >
                {form.saveError && <Alert>{form.saveError}</Alert>}
                <Input
                    label="Name"
                    value={form.draft.name}
                    onChange={(event) => form.set("name", event.target.value)}
                    error={form.errors.name}
                    hint={
                        isAccount
                            ? "The name the object is listed under in its container. The logon name stays as it is."
                            : undefined
                    }
                    autoFocus
                />
            </form>
        </Modal>
    );
};

// ── Password ─────────────────────────────────────────────────────────────────

interface PasswordDialogProps {
    accountName: string;
    /** A password that never expires cannot be one that has to be changed at the next logon. */
    passwordNeverExpires: boolean;
    onClose: () => void;
    onSave: (input: SetPassword) => Promise<unknown>;
}

/** Sets a new password for a user. What the domain's policy thinks of it is its answer, shown here. */
export const PasswordDialog = ({ accountName, passwordNeverExpires, onClose, onSave }: PasswordDialogProps) => {
    const form = useEntityForm({
        initial: { ...EMPTY_PASSWORD_DRAFT, mustChangePassword: !passwordNeverExpires },
        schema: SetPasswordSchema,
        toInput: (draft) => ({ password: draft.password, mustChangePassword: draft.mustChangePassword }),
        fieldOf: passwordFieldOf,
        rules: passwordRules,
        // Ticking the box alone is not a password to set.
        significant: (draft) => draft.password + draft.passwordRepeat,
    });
    const formId = "directory-password-form";

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={`Set password of ${accountName}`}
            closeOnOverlayClick={false}
            footer={
                <>
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button type="submit" form={formId} variant="primary" disabled={!form.canSave} isLoading={form.isSaving}>
                        Set Password
                    </Button>
                </>
            }
        >
            <form
                id={formId}
                className="space-y-4"
                onSubmit={async (event) => {
                    event.preventDefault();
                    if (await form.submit(onSave)) onClose();
                }}
            >
                {form.saveError && <Alert>{form.saveError}</Alert>}
                <Input
                    label="New password"
                    type="password"
                    autoComplete="new-password"
                    value={form.draft.password}
                    onChange={(event) => form.set("password", event.target.value)}
                    error={form.errors.password}
                    autoFocus
                />
                <Input
                    label="Repeat password"
                    type="password"
                    autoComplete="new-password"
                    value={form.draft.passwordRepeat}
                    onChange={(event) => form.set("passwordRepeat", event.target.value)}
                    error={form.errors.passwordRepeat}
                />
                <Checkbox
                    label="User must change the password at next logon"
                    checked={form.draft.mustChangePassword}
                    disabled={passwordNeverExpires}
                    hint={passwordNeverExpires ? "Not for a password that never expires." : undefined}
                    onChange={(event) => form.set("mustChangePassword", event.target.checked)}
                />
            </form>
        </Modal>
    );
};

// ── Pick objects ─────────────────────────────────────────────────────────────

interface ObjectPickerDialogProps {
    title: string;
    /** The kinds that can be picked. */
    types: ("user" | "group" | "computer")[];
    confirmLabel: string;
    /** Objects that are in already, and so not offered. */
    excludeGuids?: ReadonlySet<string>;
    onClose: () => void;
    onPick: (objects: DirectoryRef[]) => Promise<unknown>;
}

const SEARCH_DELAY_MS = 250;

/**
 * Finds users, groups or computers by the start of their name and collects the ones that
 * are meant: for the members of a group, and for the groups of an account.
 */
export const ObjectPickerDialog = ({ title, types, confirmLabel, excludeGuids, onClose, onPick }: ObjectPickerDialogProps) => {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<DirectoryRef[]>([]);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [picked, setPicked] = useState<DirectoryRef[]>([]);
    const { isRunning, error, run } = useDialogAction(onClose);
    const typeKey = types.join(",");

    useEffect(() => {
        const text = query.trim();
        // Each keystroke starts the wait anew; only the query that is still the current one is shown.
        let current = true;
        const timer = setTimeout(async () => {
            if (text === "") {
                if (current) setResults([]);
                return;
            }
            try {
                const found = await searchDirectory(text, typeKey.split(",") as ("user" | "group" | "computer")[]);
                if (current) {
                    setResults(found);
                    setSearchError(null);
                }
            } catch (e) {
                if (current) setSearchError(getErrorMessage(e));
            }
        }, SEARCH_DELAY_MS);
        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [query, typeKey]);

    const pickedGuids = new Set(picked.map((object) => object.guid));
    const offered = results.filter((object) => !excludeGuids?.has(object.guid));
    const toggle = (object: DirectoryRef) =>
        setPicked((current) =>
            current.some((other) => other.guid === object.guid)
                ? current.filter((other) => other.guid !== object.guid)
                : [...current, object],
        );

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={title}
            size="lg"
            closeOnOverlayClick={false}
            footer={
                <>
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button
                        type="button"
                        variant="primary"
                        disabled={picked.length === 0}
                        isLoading={isRunning}
                        onClick={() => void run(() => onPick(picked))}
                    >
                        {confirmLabel}
                        {picked.length > 0 ? ` (${picked.length})` : ""}
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                {error && <Alert>{error}</Alert>}
                <Input
                    label="Search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Start of a name…"
                    icon={Search}
                    error={searchError ?? undefined}
                    autoFocus
                />
                <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
                    {offered.length === 0 && (
                        <li className="px-3 py-6 text-center text-sm text-text-muted">
                            {query.trim() === "" ? "Type the start of a name." : "Nothing found."}
                        </li>
                    )}
                    {offered.map((object) => (
                        <li key={object.guid} className="px-3 py-2">
                            <Checkbox
                                checked={pickedGuids.has(object.guid)}
                                onChange={() => toggle(object)}
                                label={
                                    <span className="flex min-w-0 items-center gap-2">
                                        <ObjectIcon type={object.type} />
                                        <span className="font-medium text-text-primary">{object.name}</span>
                                        {object.detail && <span className="truncate text-text-muted">{object.detail}</span>}
                                    </span>
                                }
                            />
                        </li>
                    ))}
                </ul>
                {picked.length > 0 && (
                    <p className="text-sm text-text-muted">Chosen: {picked.map((object) => object.name).join(", ")}</p>
                )}
            </div>
        </Modal>
    );
};
