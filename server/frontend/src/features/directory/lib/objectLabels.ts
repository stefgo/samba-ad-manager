/** How each kind of directory object is called on screen. */
export const OBJECT_TYPE_LABELS: Record<string, string> = {
    user: "User",
    group: "Group",
    computer: "Computer",
    ou: "Organizational unit",
    container: "Container",
    builtin: "Container",
    domain: "Domain",
    other: "Other",
};

/** `DC1$` is the account; `DC1` is what the machine is called. */
export const computerName = (computer: { accountName: string }): string => computer.accountName.replace(/\$$/, "");

/** Whether an account's expiry date has passed at `now`. Never, for an account without one. */
export const isExpired = (accountExpires: string | null | undefined, now: number): boolean =>
    !!accountExpires && Date.parse(accountExpires) < now;
