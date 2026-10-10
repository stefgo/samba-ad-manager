import { CONNECTION_MODE, UpdateClientSchema, type Client } from "@sadm/shared";
import type { z } from "zod";
import type { FieldErrors, FieldOf } from "../../../lib/entityForm";

/** The client editor's fields, as typed. */
export interface ClientDraft {
    displayName: string;
    /** A label for where the domain controller stands; the list groups by it. */
    site: string;
    /** Outbound clients only: where the server dials the agent. */
    targetAddress: string;
    /** Inbound clients only: whether connections are checked against `allowedIp`. */
    restrictIp: boolean;
    allowedIp: string;
}

export type ClientUpdateInput = z.input<typeof UpdateClientSchema>;

/** What the server holds, as far as the form compares against it. */
type StoredClient = Pick<Client, "inboundAllowedIp" | "outboundTargetAddress">;

export const isOutbound = (client: Pick<Client, "connectionMode">) =>
    client.connectionMode === CONNECTION_MODE.OUTBOUND;

export function clientDraftFrom(client: Client): ClientDraft {
    return {
        displayName: client.displayName || "",
        site: client.site || "",
        targetAddress: client.outboundTargetAddress || "",
        restrictIp: !!client.inboundAllowedIp,
        allowedIp: client.inboundAllowedIp || "",
    };
}

/**
 * The draft as `PUT /api/v1/clients/:id` takes it. Which address is sent follows from the
 * connection mode: the backend rejects a target address for an inbound client and an
 * allowed address for an outbound one.
 *
 * An address is sent only when it differs from what is stored. An absent key leaves the
 * stored value alone, so a value the schema would not accept today -- the IPv6 address a
 * client registered from, a target address written before it was checked -- stays savable
 * as long as it is not touched. `null` is not "unchanged" but "switch the check off".
 */
export function clientInputFrom(draft: ClientDraft, outbound: boolean, stored: StoredClient): ClientUpdateInput {
    const input: ClientUpdateInput = {
        displayName: draft.displayName.trim(),
        // An empty site is no site: `null` clears it.
        site: draft.site.trim() || null,
    };

    if (outbound) {
        const targetAddress = draft.targetAddress.trim();
        if (targetAddress !== (stored.outboundTargetAddress || "")) input.outboundTargetAddress = targetAddress;
    } else if (!draft.restrictIp) {
        if (stored.inboundAllowedIp) input.inboundAllowedIp = null;
    } else {
        const allowedIp = draft.allowedIp.trim();
        if (allowedIp !== (stored.inboundAllowedIp || "")) input.inboundAllowedIp = allowedIp;
    }

    return input;
}

/**
 * What of the draft is sent at all, and so what counts as a change. Unticking a box is a
 * change in its own right; what is left in the field under it is not.
 */
export function significantClientDraft(draft: ClientDraft, outbound: boolean): Partial<ClientDraft> {
    const shared = { displayName: draft.displayName.trim(), site: draft.site.trim() };
    if (outbound) return { ...shared, targetAddress: draft.targetAddress.trim() };
    return {
        ...shared,
        restrictIp: draft.restrictIp,
        allowedIp: draft.restrictIp ? draft.allowedIp.trim() : "",
    };
}

/** What the schema cannot say: which of the two addresses this client has to have. */
export function clientRules(draft: ClientDraft, outbound: boolean): FieldErrors<ClientDraft> {
    if (outbound) {
        return draft.targetAddress.trim() ? {} : { targetAddress: "An outbound client needs the address the server dials." };
    }
    // Required only while the box is ticked: that is what ticking it means.
    return draft.restrictIp && !draft.allowedIp.trim()
        ? { allowedIp: "Enter an address or a network, or untick the box above." }
        : {};
}

export const clientFieldOf: FieldOf<ClientDraft> = (path) => {
    switch (path[0]) {
        case "displayName":
        case "site":
            return path[0];
        case "outboundTargetAddress":
            return "targetAddress";
        case "inboundAllowedIp":
            return "allowedIp";
        default:
            return null;
    }
};

/** What the form holds once it is stored: the server keeps the trimmed values. */
export function storedClientDraft(draft: ClientDraft): ClientDraft {
    return {
        ...draft,
        displayName: draft.displayName.trim(),
        site: draft.site.trim(),
        targetAddress: draft.targetAddress.trim(),
        allowedIp: draft.allowedIp.trim(),
    };
}
