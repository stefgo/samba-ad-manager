import type { ActivityRecord } from "@sadm/shared";
import { paths } from "../../../lib/paths";

/**
 * Where the chips of an event lead: the page of the domain controller it is about. A chip
 * without a target stays text.
 *
 * A domain controller the directory no longer lists has no page left, which is why the ids
 * of the known ones are asked for.
 */
export interface ActivityLinks {
    dc?: string;
}

export function activityLinks(event: ActivityRecord, knownDcIds: ReadonlySet<string>): ActivityLinks {
    const links: ActivityLinks = {};
    const dcId = event.dcId && knownDcIds.has(event.dcId) ? event.dcId : null;

    if (dcId) links.dc = paths.domainController(dcId);

    return links;
}
