/**
 * Which domain controller this agent runs on: the GUID of its NTDS settings, read from the
 * local database once at startup. It is what the server knows the domain controller by, what
 * a registration is good for, and what every connection says again -- so an identity that
 * was carried to another domain controller with its volume is refused instead of reporting
 * under the wrong name.
 *
 * Kept here rather than read where it is needed: every user of it needs it at once, and
 * reading it starts an interpreter.
 */
let dcId: string | null = null;

export function setDcId(id: string): void {
    dcId = id.toLowerCase();
}

/** The id, or null before the database could be read. */
export function getDcId(): string | null {
    return dcId;
}
