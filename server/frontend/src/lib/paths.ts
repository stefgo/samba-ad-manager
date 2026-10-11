import { generatePath } from "react-router-dom";

/**
 * Every path of the application, once. The routes take their `path`s from here, and
 * whatever navigates takes a pattern (no parameter) or one of the builders in `paths`
 * below. **No path literal anywhere else.**
 *
 * The patterns are absolute, also for a nested route: the tree says who is whose parent,
 * this says what the address bar shows.
 */
export const ROUTES = {
    login: "/login",
    // The dashboard: what needs a look, across the whole domain.
    root: "/",

    // The domain controllers the directory lists, each addressed by the GUID of its NTDS settings.
    domainControllers: "/domain-controllers",
    domainController: "/domain-controllers/:dcId",

    // The directory's objects. A user, group or computer is addressed by its GUID, which
    // outlives a rename and a move.
    directoryUsers: "/directory/users",
    directoryUser: "/directory/users/:guid",
    directoryGroups: "/directory/groups",
    directoryGroup: "/directory/groups/:guid",
    directoryComputers: "/directory/computers",
    directoryComputer: "/directory/computers/:guid",
    directoryUnits: "/directory/units",

    // The DNS zones the directory holds, each addressed by the GUID of its object.
    dnsZones: "/dns",
    dnsZone: "/dns/:guid",

    activity: "/activity",
    // Who may log in to sadm -- "users" in the code. Not the users of the directory.
    users: "/accounts",

    webhooks: "/webhooks",
    webhookNew: "/webhooks/new",
    webhook: "/webhooks/:webhookId",

    settings: "/settings",
} as const;

/**
 * The patterns with their parameters filled in. A pattern without one is used as it is.
 * `generatePath` encodes every parameter, so a site with a slash in it is passed as it is.
 */
export const paths = {
    domainController: (dcId: string) => generatePath(ROUTES.domainController, { dcId }),

    directoryUser: (guid: string) => generatePath(ROUTES.directoryUser, { guid }),
    directoryGroup: (guid: string) => generatePath(ROUTES.directoryGroup, { guid }),
    directoryComputer: (guid: string) => generatePath(ROUTES.directoryComputer, { guid }),

    dnsZone: (guid: string) => generatePath(ROUTES.dnsZone, { guid }),

    webhook: (webhookId: string) => generatePath(ROUTES.webhook, { webhookId }),
};

/** The query parameter the unit browser keeps its open container in. */
export const UNIT_PARAM = "dn";

/** The unit browser opened on one container. */
export const directoryUnitPath = (dn: string) => ({
    pathname: ROUTES.directoryUnits,
    search: `?${new URLSearchParams({ [UNIT_PARAM]: dn })}`,
});

/** Where an object of the directory has its page, or undefined for a kind that has none. */
export function directoryObjectPath(object: { guid: string; dn: string; type: string }) {
    switch (object.type) {
        case "user":
            return paths.directoryUser(object.guid);
        case "group":
            return paths.directoryGroup(object.guid);
        case "computer":
            return paths.directoryComputer(object.guid);
        case "ou":
        case "container":
        case "domain":
        case "builtin":
            return directoryUnitPath(object.dn);
        default:
            return undefined;
    }
}

/** The query parameter a list keeps its search in -- see `useSearchQueryParam`. */
export const SEARCH_PARAM = "search";

/**
 * The activity list with a search set, as another page opens it. The search is the
 * page's query and not a pattern of its own -- but a link that sets it must not spell it
 * out either.
 */
export const activitySearch = (search: string) => ({
    pathname: ROUTES.activity,
    search: `?${new URLSearchParams({ [SEARCH_PARAM]: search })}`,
});
