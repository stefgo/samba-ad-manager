import type { DomainController, UpdateDomainController } from "@sadm/shared";

/**
 * The one thing set for a domain controller here: where it is reached, for when the name
 * the directory gives it does not resolve from this server.
 */
export interface AddressDraft {
    address: string;
}

export const addressDraftFrom = (dc: Pick<DomainController, "address">): AddressDraft => ({ address: dc.address ?? "" });

/** What is sent: the address, or null for an emptied field -- back to the name in the directory. */
export const addressInputFrom = (draft: AddressDraft): UpdateDomainController => ({
    address: draft.address.trim() === "" ? null : draft.address.trim(),
});

/** Which field of the form an issue of the request schema belongs to. */
export const addressFieldOf = (path: readonly PropertyKey[]): keyof AddressDraft | null => (path[0] === "address" ? "address" : null);

/** Where the server reaches a domain controller, as a reader is told it. */
export function reachedAt(dc: Pick<DomainController, "address" | "dnsHostName">): string {
    if (dc.address) return dc.address;
    return dc.dnsHostName ?? "Nowhere: the directory names no host for it";
}
