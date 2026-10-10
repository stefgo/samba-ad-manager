import type { CreateUserSchema } from "@sadm/shared";
import type { z } from "zod";
import type { FieldErrors, FieldOf } from "../../../lib/entityForm";

/** The ways an account may sign in, as the server stores them: comma separated. */
export type AuthMethod = "local" | "oidc";

/** The dialog's fields, as typed. */
export interface UserDraft {
    username: string;
    /** Only ever a new password: the server never sends a stored one back. */
    password: string;
    authMethods: AuthMethod[];
}

/** What of a stored user the form needs to know. */
export interface StoredUser {
    username: string;
    auth_methods?: string | null;
}

export type UserInput = z.input<typeof CreateUserSchema>;

/** The methods of a stored user. One stored before the column existed signs in locally. */
export function authMethodsOf(user: StoredUser): AuthMethod[] {
    const stored = (user.auth_methods || "local").split(",");
    return (["local", "oidc"] as const).filter((method) => stored.includes(method));
}

/** A new user signs in with a password; the draft of a stored one shows what it has. */
export function userDraftFrom(user: StoredUser | null): UserDraft {
    return {
        username: user?.username ?? "",
        password: "",
        authMethods: user ? authMethodsOf(user) : ["local"],
    };
}

/**
 * The draft as both `POST /api/v1/users` and `PUT /api/v1/users/:userId` take it. A
 * password goes along only with local sign-in: one typed before the box was unticked is in
 * a field that is no longer shown, and the server refuses a password for an account that
 * has no local sign-in.
 */
export function userInputFrom(draft: UserDraft): UserInput {
    const local = draft.authMethods.includes("local");
    return {
        username: draft.username,
        password: local && draft.password ? draft.password : undefined,
        auth_methods: draft.authMethods.join(","),
    };
}

/**
 * What the save button asks, said at the field. That a local account needs a password is
 * a rule the controller enforces, not part of the schema; `stored` is the user being
 * edited, whose password stands when it already signed in locally.
 */
export function userRules(draft: UserDraft, stored: StoredUser | null): FieldErrors<UserDraft> {
    const errors: FieldErrors<UserDraft> = {};
    if (!draft.username.trim()) errors.username = "Name the user.";
    if (draft.authMethods.length === 0) errors.authMethods = "Choose at least one way to sign in.";

    const hasPassword = !!stored && authMethodsOf(stored).includes("local");
    if (draft.authMethods.includes("local") && !draft.password && !hasPassword) {
        errors.password = "Local sign-in needs a password.";
    }
    return errors;
}

/** Where an issue of `CreateUserSchema` is shown. */
export const userFieldOf: FieldOf<UserDraft> = (path) => {
    switch (path[0]) {
        case "username":
        case "password":
            return path[0];
        case "auth_methods":
            return "authMethods";
        default:
            return null;
    }
};
