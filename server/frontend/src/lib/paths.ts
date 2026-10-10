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

    // The registered agents, one next to each domain controller -- "clients" in the code.
    clients: "/domain-controllers",
    clientNew: "/domain-controllers/new",
    client: "/domain-controllers/:clientId",
    clientEdit: "/domain-controllers/:clientId/edit",

    activity: "/activity",
    // Who may log in to sadm -- "users" in the code. Not the users of the directory.
    users: "/accounts",
    tokens: "/tokens",

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
    client: (clientId: string) => generatePath(ROUTES.client, { clientId }),
    clientEdit: (clientId: string) => generatePath(ROUTES.clientEdit, { clientId }),

    webhook: (webhookId: string) => generatePath(ROUTES.webhook, { webhookId }),
};

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
