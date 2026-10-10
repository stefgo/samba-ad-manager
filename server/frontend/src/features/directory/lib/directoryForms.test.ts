import { describe, expect, it } from "vitest";
import { CreateDirectoryUserSchema, CreateGroupSchema, type DirectoryUser } from "@sadm/shared";
import { checkDraft } from "../../../lib/entityForm";
import {
    createGroupInputFrom,
    createUserInputFrom,
    groupDraftFrom,
    groupFieldOf,
    passwordRules,
    updateUserInputFrom,
    userDraftFrom,
    userFieldOf,
    userRules,
} from "./directoryForms";

const PARENT = "OU=Staff,DC=sadm,DC=test";

const stored: DirectoryUser = {
    guid: "d7595c3f-81e6-41bd-920a-7a3643407f79",
    dn: `CN=Jane Doe,${PARENT}`,
    parentDn: PARENT,
    cn: "Jane Doe",
    protected: false,
    accountName: "jdoe",
    givenName: "Jane",
    surname: "Doe",
    displayName: "Jane Doe",
    mail: "jane@sadm.test",
    description: null,
    enabled: true,
    lockedOut: false,
    passwordNeverExpires: false,
    mustChangePassword: false,
};

describe("a new user", () => {
    const draft = { ...userDraftFrom(null, PARENT), accountName: "jdoe", password: "Secret-1", passwordRepeat: "Secret-1" };

    it("starts in the container the list was opened on, with a password to be changed", () => {
        expect(userDraftFrom(null, PARENT)).toMatchObject({ parentDn: PARENT, mustChangePassword: true, enabled: true });
    });

    it("leaves out what was left empty", () => {
        expect(createUserInputFrom({ ...draft, givenName: " Jane " })).toEqual({
            parentDn: PARENT,
            accountName: "jdoe",
            givenName: "Jane",
            password: "Secret-1",
            mustChangePassword: true,
            passwordNeverExpires: false,
            enabled: true,
        });
    });

    it("passes the schema the server parses it with", () => {
        const check = checkDraft(
            { schema: CreateDirectoryUserSchema, toInput: createUserInputFrom, fieldOf: userFieldOf, rules: (d) => userRules(d, true) },
            draft,
        );
        expect(check.isValid).toBe(true);
    });

    it("says at the field what the schema refuses", () => {
        const check = checkDraft(
            { schema: CreateDirectoryUserSchema, toInput: createUserInputFrom, fieldOf: userFieldOf, rules: (d) => userRules(d, true) },
            { ...draft, accountName: "j@doe" },
        );
        expect(check.errors.accountName).toContain("May not contain");
    });

    it("wants the password twice, and no contradiction in its options", () => {
        expect(userRules({ ...draft, passwordRepeat: "other" }, true).passwordRepeat).toBe("The two passwords differ.");
        expect(userRules({ ...draft, passwordNeverExpires: true }, true).passwordNeverExpires).toBeDefined();
        expect(userRules({ ...draft, mustChangePassword: false, passwordNeverExpires: true }, true)).toEqual({});
    });
});

describe("an edited user", () => {
    it("sends only what changed, and clears what was emptied", () => {
        const draft = { ...userDraftFrom(stored, PARENT), mail: "", description: "Sales", passwordNeverExpires: true };
        expect(updateUserInputFrom(draft, stored)).toEqual({ mail: null, description: "Sales", passwordNeverExpires: true });
    });

    it("sends nothing for a draft nobody touched", () => {
        expect(updateUserInputFrom(userDraftFrom(stored, PARENT), stored)).toEqual({});
    });
});

describe("passwordRules", () => {
    it("wants the password twice", () => {
        expect(passwordRules({ password: "a", passwordRepeat: "b", mustChangePassword: true })).toEqual({
            passwordRepeat: "The two passwords differ.",
        });
        expect(passwordRules({ password: "a", passwordRepeat: "a", mustChangePassword: true })).toEqual({});
    });
});

describe("a new group", () => {
    it("is a global security group unless said otherwise, and passes the schema", () => {
        const draft = { ...groupDraftFrom(PARENT), name: "staff" };
        expect(createGroupInputFrom(draft)).toEqual({ parentDn: PARENT, name: "staff", scope: "global", kind: "security" });
        const check = checkDraft({ schema: CreateGroupSchema, toInput: createGroupInputFrom, fieldOf: groupFieldOf }, draft);
        expect(check.isValid).toBe(true);
    });
});
