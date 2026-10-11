import type { RouteObject } from "react-router-dom";
import {
    Activity,
    FolderTree,
    Globe,
    LayoutDashboard,
    Monitor,
    Server,
    Settings as SettingsIcon,
    User,
    UserCog,
    Users,
    Webhook,
} from "lucide-react";
import type { DashboardPage } from "@stefgo/react-ui-components";

import { ROUTES } from "../../lib/paths";
import type { TitleHandle, TitleSubject } from "../../lib/pageTitle";
import { RouteError } from "./RouteError";
import {
    ActivityView,
    DashboardOverview,
    DirectoryComputerDetail,
    DirectoryComputerList,
    DirectoryGroupDetail,
    DirectoryGroupList,
    DirectoryUnitBrowser,
    DirectoryUserDetail,
    DirectoryUserList,
    DnsZoneList,
    DnsZonePage,
    Settings,
    UserOverview,
    WebhookEditorRoute,
    WebhookOverview,
} from "./lazyPages";
import {
    DomainControllerBoundary,
    DomainControllerDetailRoute,
    DomainControllersRoute,
    NotFound,
} from "./routeElements";

type PageNav = NonNullable<DashboardPage["nav"]>;

/**
 * The part of a sidebar entry that is fixed: where it sits and what it is called. What
 * changes while the application runs -- how many domain controllers answer, the dot for
 * unseen activity --
 * is added by `AppLayout`, by `id`.
 */
export interface NavEntry extends Pick<PageNav, "label" | "icon" | "groupId" | "placement"> {
    id: string;
}

/**
 * What a route's `handle` may carry. The router types it as `any`; this is what is read.
 * `title` and `subject` are what the document title is made of -- see `lib/pageTitle.ts`.
 */
export interface RouteHandle extends TitleHandle {
    nav?: NavEntry;
}

const nav = (entry: NavEntry): RouteHandle => ({ nav: entry });

/** A route called by a fixed name: a form, mostly. */
const titled = (title: string): RouteHandle => ({ title });

/** A route about one thing, called by its name -- and by `title` until the name is known. */
const about = (subject: TitleSubject, title?: string): RouteHandle => ({ subject, title });

/**
 * Everything inside the dashboard shell, as one tree. It is the only description of what
 * lives where:
 *
 * - **Paths** come from `lib/paths.ts`, each used here exactly once.
 * - **The sidebar** is the areas that carry `handle.nav`, in this order. An entry is
 *   marked while any route below its area is open -- nothing lists those routes again.
 * - **The document title** is the handles along the open route: the area's label, the
 *   `subject` a route is about, the `title` of a form.
 * - **Back** is the route above in this tree (`useBackPath`): a webhook's editor closes
 *   onto the list, a domain controller's page onto the list of them.
 * - **Not found and render errors** are the area's `errorElement`: the page is replaced,
 *   the shell around it stays.
 */
export const shellRoutes: RouteObject[] = [
    {
        path: ROUTES.root,
        handle: nav({ id: "dashboard", groupId: "overview", label: "Dashboard", icon: LayoutDashboard }),
        errorElement: <RouteError />,
        element: <DashboardOverview />,
    },
    // The directory's objects. A detail page is called by its kind in the browser tab: the
    // shell does not read the directory, and does not start to for a title. The page's own
    // header names the object.
    {
        path: ROUTES.directoryUsers,
        handle: nav({ id: "directory-users", groupId: "directory", label: "Users", icon: User }),
        errorElement: <RouteError />,
        children: [
            { index: true, element: <DirectoryUserList /> },
            { path: ROUTES.directoryUser, handle: titled("User"), element: <DirectoryUserDetail /> },
        ],
    },
    {
        path: ROUTES.directoryGroups,
        handle: nav({ id: "directory-groups", groupId: "directory", label: "Groups", icon: Users }),
        errorElement: <RouteError />,
        children: [
            { index: true, element: <DirectoryGroupList /> },
            { path: ROUTES.directoryGroup, handle: titled("Group"), element: <DirectoryGroupDetail /> },
        ],
    },
    {
        path: ROUTES.directoryComputers,
        handle: nav({ id: "directory-computers", groupId: "directory", label: "Computers", icon: Monitor }),
        errorElement: <RouteError />,
        children: [
            { index: true, element: <DirectoryComputerList /> },
            { path: ROUTES.directoryComputer, handle: titled("Computer"), element: <DirectoryComputerDetail /> },
        ],
    },
    {
        path: ROUTES.directoryUnits,
        handle: nav({
            id: "directory-units",
            groupId: "directory",
            placement: "mobile-more",
            label: "Organizational Units",
            icon: FolderTree,
        }),
        errorElement: <RouteError />,
        element: <DirectoryUnitBrowser />,
    },
    // The DNS zones. They are objects of the directory like the rest of this group, and are
    // read the same way.
    {
        path: ROUTES.dnsZones,
        handle: nav({ id: "dns", groupId: "directory", placement: "mobile-more", label: "DNS", icon: Globe }),
        errorElement: <RouteError />,
        children: [
            { index: true, element: <DnsZoneList /> },
            { path: ROUTES.dnsZone, handle: titled("Zone"), element: <DnsZonePage /> },
        ],
    },
    {
        path: ROUTES.domainControllers,
        handle: nav({ id: "domainControllers", groupId: "infrastructure", label: "Domain Controllers", icon: Server }),
        errorElement: <RouteError />,
        children: [
            { index: true, element: <DomainControllersRoute /> },
            {
                path: ROUTES.domainController,
                handle: about("domainController", "Domain Controller"),
                element: <DomainControllerBoundary />,
                children: [{ index: true, element: <DomainControllerDetailRoute /> }],
            },
        ],
    },
    {
        path: ROUTES.activity,
        handle: nav({ id: "activity", groupId: "system", label: "Activity", icon: Activity }),
        errorElement: <RouteError />,
        element: <ActivityView />,
    },
    {
        path: ROUTES.users,
        handle: nav({ id: "users", groupId: "system", placement: "mobile-more", label: "Accounts", icon: UserCog }),
        errorElement: <RouteError />,
        element: <UserOverview />,
    },
    {
        path: ROUTES.webhooks,
        handle: nav({ id: "webhooks", groupId: "system", placement: "mobile-more", label: "Webhooks", icon: Webhook }),
        errorElement: <RouteError />,
        children: [
            { index: true, element: <WebhookOverview /> },
            { path: ROUTES.webhookNew, handle: titled("New Webhook"), element: <WebhookEditorRoute /> },
            // By its kind, not its name: the shell does not read the webhooks, and does not
            // start to for a title.
            { path: ROUTES.webhook, handle: titled("Webhook"), element: <WebhookEditorRoute /> },
        ],
    },
    {
        path: ROUTES.settings,
        handle: nav({ id: "settings", groupId: "system", placement: "mobile-more", label: "Settings", icon: SettingsIcon }),
        errorElement: <RouteError />,
        element: <Settings />,
    },
    { path: "*", handle: titled("Not Found"), element: <NotFound /> },
];

/** The sidebar entries, read off the tree: every area with a `handle.nav`, and its path. */
export const navEntries = shellRoutes.flatMap((route) => {
    const entry = (route.handle as RouteHandle | undefined)?.nav;
    return entry && route.path ? [{ ...entry, path: route.path }] : [];
});
