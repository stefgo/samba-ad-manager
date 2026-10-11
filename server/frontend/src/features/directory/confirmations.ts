import type { ConfirmOptions } from "@stefgo/react-ui-components";

/** What goes with deleting an object, by its kind: said before, because it cannot be taken back. */
export function describeDeleteObject(object: { name: string; type: string; subobjectCount?: number | null }): ConfirmOptions {
    const consequence: Record<string, string> = {
        user: "The account can no longer log on, and it loses its group memberships. A new account of the same name is a different one: it has another SID, and nothing the old one was allowed is allowed to it.",
        group: "Its members lose what the group gave them access to. A new group of the same name is a different one: it has another SID.",
        computer: "The machine can no longer log on to the domain and has to be joined again.",
        ou: "Only an empty organizational unit can be deleted. Group policies linked to it no longer apply to anything.",
    };
    const count = object.subobjectCount ?? 0;
    // What a machine or an application keeps below an account goes along, and is named for that reason.
    const kept = object.type === "computer" ? "BitLocker recovery keys or published printers" : "what an application keeps with the account";
    const objects = count === 1 ? "The 1 object below it is" : `The ${count} objects below it are`;
    const below = count > 0 ? ` ${objects} deleted with it, such as ${kept}.` : "";
    return {
        title: `Delete ${object.name}?`,
        description: `${consequence[object.type] ?? "The object is removed from the directory."}${below} This cannot be undone from here.`,
        confirmLabel: "Delete",
        variant: "danger",
    };
}

export function describeDisableAccount(object: { name: string; type: string }): ConfirmOptions {
    return {
        title: `Disable ${object.name}?`,
        description:
            object.type === "computer"
                ? "The machine can no longer log on to the domain until the account is enabled again. Nothing else changes."
                : "The user can no longer log on until the account is enabled again. Group memberships and the password stay as they are.",
        confirmLabel: "Disable",
        variant: "danger",
    };
}

export function describeRemoveMember(member: string, group: string): ConfirmOptions {
    return {
        title: `Remove ${member} from ${group}?`,
        description: `${member} loses what the group gives access to, from its next logon on.`,
        confirmLabel: "Remove",
        variant: "danger",
    };
}
