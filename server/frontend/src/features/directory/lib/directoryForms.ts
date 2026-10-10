import type { CreateDirectoryUser, CreateGroup, DirectoryUser, UpdateDirectoryUser } from "@sadm/shared";
import type { GroupKind, GroupScope } from "@sadm/shared";
import type { FieldErrors, FieldOf } from "../../../lib/entityForm";

// ── Users ────────────────────────────────────────────────────────────────────

/** The fields of the user dialog, as typed. The same form creates a user and edits one. */
export interface UserDraft {
    parentDn: string;
    accountName: string;
    givenName: string;
    surname: string;
    displayName: string;
    userPrincipalName: string;
    mail: string;
    description: string;
    password: string;
    passwordRepeat: string;
    mustChangePassword: boolean;
    passwordNeverExpires: boolean;
    enabled: boolean;
}

export function userDraftFrom(user: DirectoryUser | null, parentDn: string): UserDraft {
    return {
        parentDn: user?.parentDn ?? parentDn,
        accountName: user?.accountName ?? "",
        givenName: user?.givenName ?? "",
        surname: user?.surname ?? "",
        displayName: user?.displayName ?? "",
        userPrincipalName: user?.userPrincipalName ?? "",
        mail: user?.mail ?? "",
        description: user?.description ?? "",
        password: "",
        passwordRepeat: "",
        mustChangePassword: user ? false : true,
        passwordNeverExpires: user?.passwordNeverExpires ?? false,
        enabled: user?.enabled ?? true,
    };
}

/** An empty field of a new object is left out; the server fills in what has a default. */
const optional = (value: string): string | undefined => (value.trim() === "" ? undefined : value.trim());

/** An emptied field of an existing object clears the attribute. */
const clearable = (value: string): string | null => (value.trim() === "" ? null : value.trim());

export function createUserInputFrom(draft: UserDraft): CreateDirectoryUser {
    return {
        parentDn: draft.parentDn,
        accountName: draft.accountName,
        givenName: optional(draft.givenName),
        surname: optional(draft.surname),
        displayName: optional(draft.displayName),
        userPrincipalName: optional(draft.userPrincipalName),
        mail: optional(draft.mail),
        description: optional(draft.description),
        password: draft.password,
        mustChangePassword: draft.mustChangePassword,
        passwordNeverExpires: draft.passwordNeverExpires,
        enabled: draft.enabled,
    };
}

/** What changed against the stored user, and nothing else: an attribute nobody touched is not written. */
export function updateUserInputFrom(draft: UserDraft, stored: DirectoryUser): UpdateDirectoryUser {
    const changes: UpdateDirectoryUser = {};
    const text = (key: "givenName" | "surname" | "displayName" | "userPrincipalName" | "mail" | "description") => {
        const next = clearable(draft[key]);
        if (next !== (stored[key] ?? null)) changes[key] = next;
    };
    text("givenName");
    text("surname");
    text("displayName");
    text("userPrincipalName");
    text("mail");
    text("description");
    if (draft.passwordNeverExpires !== stored.passwordNeverExpires) changes.passwordNeverExpires = draft.passwordNeverExpires;
    return changes;
}

/** What the schema does not say: the two passwords are the same, and the two password options do not contradict. */
export function userRules(draft: UserDraft, isNew: boolean): FieldErrors<UserDraft> {
    const errors: FieldErrors<UserDraft> = {};
    if (isNew) {
        if (!draft.parentDn) errors.parentDn = "Choose where the user is created.";
        if (draft.password !== draft.passwordRepeat) errors.passwordRepeat = "The two passwords differ.";
    }
    if (draft.mustChangePassword && draft.passwordNeverExpires) {
        errors.passwordNeverExpires = "A password that never expires cannot be one that has to be changed.";
    }
    return errors;
}

export const userFieldOf: FieldOf<UserDraft> = (path) => {
    const key = path[0];
    return typeof key === "string" && key in userDraftFrom(null, "") ? (key as keyof UserDraft) : null;
};

// ── Password ─────────────────────────────────────────────────────────────────

export interface PasswordDraft {
    password: string;
    passwordRepeat: string;
    mustChangePassword: boolean;
}

export const EMPTY_PASSWORD_DRAFT: PasswordDraft = { password: "", passwordRepeat: "", mustChangePassword: true };

export function passwordRules(draft: PasswordDraft): FieldErrors<PasswordDraft> {
    return draft.password !== draft.passwordRepeat ? { passwordRepeat: "The two passwords differ." } : {};
}

export const passwordFieldOf: FieldOf<PasswordDraft> = (path) =>
    path[0] === "password" || path[0] === "mustChangePassword" ? path[0] : null;

// ── Groups ───────────────────────────────────────────────────────────────────

export interface GroupDraft {
    parentDn: string;
    name: string;
    description: string;
    mail: string;
    scope: GroupScope;
    kind: GroupKind;
}

export const groupDraftFrom = (parentDn: string): GroupDraft => ({
    parentDn,
    name: "",
    description: "",
    mail: "",
    scope: "global",
    kind: "security",
});

export function createGroupInputFrom(draft: GroupDraft): CreateGroup {
    return {
        parentDn: draft.parentDn,
        name: draft.name,
        description: optional(draft.description),
        mail: optional(draft.mail),
        scope: draft.scope,
        kind: draft.kind,
    };
}

export const groupFieldOf: FieldOf<GroupDraft> = (path) => {
    const key = path[0];
    return typeof key === "string" && key in groupDraftFrom("") ? (key as keyof GroupDraft) : null;
};

export const GROUP_SCOPE_LABELS: Record<GroupScope, string> = {
    global: "Global",
    domainLocal: "Domain local",
    universal: "Universal",
};

export const GROUP_KIND_LABELS: Record<GroupKind, string> = {
    security: "Security",
    distribution: "Distribution",
};
