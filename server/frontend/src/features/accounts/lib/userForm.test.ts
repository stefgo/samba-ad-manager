import { describe, expect, it } from "vitest";
import { CreateUserSchema } from "@sadm/shared";
import { checkDraft } from "../../../lib/entityForm";
import {
    authMethodsOf,
    userDraftFrom,
    userFieldOf,
    userInputFrom,
    userRules,
    type StoredUser,
    type UserDraft,
} from "./userForm";

const local: StoredUser = { username: "stefan", auth_methods: "local" };
const sso: StoredUser = { username: "guest", auth_methods: "oidc" };

const draft = (changes: Partial<UserDraft> = {}): UserDraft => ({
    username: "stefan",
    password: "secret",
    authMethods: ["local"],
    ...changes,
});

const check = (d: UserDraft, stored: StoredUser | null = null) =>
    checkDraft(
        { schema: CreateUserSchema, toInput: userInputFrom, fieldOf: userFieldOf, rules: (x: UserDraft) => userRules(x, stored) },
        d,
    );

describe("authMethodsOf", () => {
    it("reads the stored list", () => {
        expect(authMethodsOf({ username: "a", auth_methods: "oidc,local" })).toEqual(["local", "oidc"]);
        expect(authMethodsOf(sso)).toEqual(["oidc"]);
    });

    it("takes a user stored without the column for a local one", () => {
        expect(authMethodsOf({ username: "a", auth_methods: null })).toEqual(["local"]);
        expect(authMethodsOf({ username: "a" })).toEqual(["local"]);
    });
});

describe("userDraftFrom", () => {
    it("starts a new user with local sign-in and nothing typed", () => {
        expect(userDraftFrom(null)).toEqual({ username: "", password: "", authMethods: ["local"] });
    });

    it("shows a stored user without a password", () => {
        expect(userDraftFrom(sso)).toEqual({ username: "guest", password: "", authMethods: ["oidc"] });
    });
});

describe("userInputFrom", () => {
    it("sends the methods comma separated", () => {
        expect(userInputFrom(draft({ authMethods: ["local", "oidc"] }))).toEqual({
            username: "stefan",
            password: "secret",
            auth_methods: "local,oidc",
        });
    });

    it("leaves an empty password out, so the stored one stands", () => {
        expect(userInputFrom(draft({ password: "" })).password).toBeUndefined();
    });

    it("does not send a password typed before local sign-in was unticked", () => {
        expect(userInputFrom(draft({ authMethods: ["oidc"] })).password).toBeUndefined();
    });
});

describe("the checks on a user", () => {
    it("accepts a new local user with a password", () => {
        expect(check(draft()).isValid).toBe(true);
    });

    it("asks for a name", () => {
        expect(check(draft({ username: "  " })).errors).toEqual({ username: "Name the user." });
    });

    it("refuses a user with no way to sign in, at the methods", () => {
        expect(check(draft({ authMethods: [] })).errors).toEqual({
            authMethods: "Choose at least one way to sign in.",
        });
    });

    it("asks a new local user for a password", () => {
        expect(check(draft({ password: "" })).errors).toEqual({ password: "Local sign-in needs a password." });
    });

    it("asks for no password while local sign-in is off", () => {
        expect(check(draft({ password: "", authMethods: ["oidc"] })).isValid).toBe(true);
    });

    it("lets a user that signs in locally keep its password", () => {
        expect(check(draft({ password: "" }), local).isValid).toBe(true);
    });

    it("asks for a password when local sign-in is added to a user that had none", () => {
        expect(check(draft({ username: "guest", password: "", authMethods: ["local", "oidc"] }), sso).errors).toEqual({
            password: "Local sign-in needs a password.",
        });
    });
});
