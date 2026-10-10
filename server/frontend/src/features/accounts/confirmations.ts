import type { AlertOptions, ConfirmOptions } from "@stefgo/react-ui-components";

/**
 * Deliberately no "loses access immediately": the API checks only the JWT's signature and
 * expiry, not whether the account still exists, so a session the account already holds
 * keeps working until it expires.
 */
export function describeDeleteUser(username: string): ConfirmOptions {
    return {
        title: `Delete user "${username}"?`,
        description: "The account can no longer sign in. A session it has already opened stays valid until it expires. Nothing else is removed with it -- domain controllers, registration tokens and the activity belong to the installation, not to an account.",
        confirmLabel: "Delete account",
        variant: "danger",
    };
}

/**
 * Nothing is deleted here. The notice exists to say why the delete does not happen, in the
 * place where the operator asked for it.
 */
export function describeLastUser(username: string): AlertOptions {
    return {
        title: "Cannot delete the last account",
        description: `"${username}" is the only account left. Deleting it would lock everyone out of this interface, so the server refuses it. Create a second user first.`,
    };
}
