import type { ActivityRecord } from "@sadm/shared";
import { paths } from "../../../lib/paths";

/**
 * Where the chips of an event lead: the page of the domain controller it happened on. A
 * chip without a target stays text.
 *
 * A client that has been deleted since has no page left, which is why the ids of the known
 * clients are asked for.
 */
export interface ActivityLinks {
    client?: string;
}

export function activityLinks(event: ActivityRecord, knownClientIds: ReadonlySet<string>): ActivityLinks {
    const links: ActivityLinks = {};
    const clientId = event.clientId && knownClientIds.has(event.clientId) ? event.clientId : null;

    if (clientId) links.client = paths.client(clientId);

    return links;
}
