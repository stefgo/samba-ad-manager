import { Suspense, useEffect, useMemo } from "react";
import { Outlet, useLocation, useMatches, useNavigate } from "react-router-dom";
import {
    ConnectionBanner,
    Dashboard,
    DashboardNavGroup,
    DashboardPage,
    LoadingIndicator,
    StatusDotProvider,
    useTheme,
} from "@stefgo/react-ui-components";

import { useAuth } from "../auth/AuthContext";
import { BreadcrumbContext } from "./context/BreadcrumbContext";
import { useWebSocket } from "./context/WebSocketContext";
import { navEntries, type RouteHandle } from "./routes";
import { APP_NAME, routeTitle, type TitleSubject } from "../../lib/pageTitle";
import { breadcrumb } from "../../lib/breadcrumb";

// Hooks, queries & stores
import { useSearchHotkey } from "../../hooks/useSearchHotkey";
import { useUIStore } from "../../stores/useUIStore";
import { answeringCount, formatAnsweringCount } from "../dashboard/lib/dashboard";
import { useProblemToasts } from "../activity/hooks/useProblemToasts";
import { useUnseenTone } from "../../queries/activity";
import { useDomainControllers } from "../../queries/domainControllers";
import { useDomainHealth } from "../domain/hooks/useDomainHealth";

type PageNav = NonNullable<DashboardPage["nav"]>;

const NAV_GROUPS: DashboardNavGroup[] = [
    { id: "overview" },
    { id: "directory", title: "Directory" },
    { id: "infrastructure", title: "Infrastructure" },
    { id: "system", title: "System" },
];

/** The dashboard shell around every page behind the login. The page itself is the outlet. */
export function AppLayout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    // The area the open route belongs to -- the innermost match that carries a sidebar
    // entry. This is what marks the entry while an editor or a detail view is open.
    const matches = useMatches();
    const activeId = matches
        .map((match) => (match.handle as RouteHandle | undefined)?.nav?.id)
        .filter(Boolean)
        .pop();

    useSearchHotkey();
    useProblemToasts();

    const { theme, toggleTheme } = useTheme();
    const { isSidebarCollapsed, toggleSidebarCollapsed } = useUIStore();
    // A pulsing dot says "this is live". Once the socket is lost nobody is watching the
    // state any more, so no dot below pulses until it is back, and the banner says why.
    const isLost = useWebSocket()?.isLost ?? false;

    // Activity. The badge only signals that something needs a look: red for an unseen error,
    // yellow for an unseen warning, nothing otherwise.
    const activityTone =
        useUnseenTone() ?? undefined;

    // The shell needs the domain controllers for the sidebar badge and the title. The
    // WebSocket pushes them on connect, the query covers a slow socket.
    const { domainControllers } = useDomainControllers();
    const { domain } = useDomainHealth();

    // Counted by the function the dashboard's card uses, so the two cannot disagree.
    const controllersBadge = useMemo(() => formatAnsweringCount(answeringCount(domain.controllers)), [domain]);

    // The browser tab names the area and what is open in it, and the breadcrumb in the
    // page's header spells the same out as links. Here rather than in each page: the route
    // tree says what a page is. A domain controller is called by the name the directory gives it.
    const { title, crumbs } = useMemo(() => {
        const { dcId } = matches[matches.length - 1]?.params ?? {};
        const nameOf = (subject: TitleSubject) => {
            switch (subject) {
                case "domainController":
                    return domainControllers.find((dc) => dc.id === dcId)?.name;
            }
        };
        const handles = matches.map((match) => match.handle as RouteHandle | undefined);
        return {
            title: routeTitle(handles, nameOf),
            crumbs: breadcrumb(
                matches.map(({ pathname }, i) => ({ pathname, handle: handles[i] })),
                nameOf,
            ),
        };
    }, [matches, domainControllers]);

    // Taken back when the shell goes: the login page behind a logout is not the page
    // that was open before it.
    useEffect(() => {
        document.title = title;
        return () => {
            document.title = APP_NAME;
        };
    }, [title]);

    // Dashboard Props. The name comes from /api/v1/me; the page used to decode it out of
    // the JWT, which lives in an httpOnly cookie now.
    const username = user?.username ?? "User";

    const logo = (
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center text-white leading-none">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-6 h-6"
            >
                {/* The glyph of public/favicon.svg, on the same gradient plate. */}
                <path d="M12 2.5 22 20.5H2Z" />
                <path strokeWidth="1.5" d="M12 10v3M8 16.5V15a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1.5" />
                <g fill="currentColor" stroke="none">
                    <circle cx="12" cy="9.5" r="1.6" />
                    <circle cx="8" cy="16.5" r="1.6" />
                    <circle cx="16" cy="16.5" r="1.6" />
                </g>
            </svg>
        </div>
    );

    const brand = (
        <div className="flex flex-col">
            <h1 className="text-xl font-bold text-text-primary leading-tight">
                S<span className="text-primary">AD</span>M
            </h1>
            <span className="pt-1 text-[10px] font-mono text-text-muted -mt-1 leading-none">
                {typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.0.0"}
            </span>
        </div>
    );

    // Navigation only -- the route tree decides what is rendered, and which entries exist.
    // What is added here is what only the running application knows.
    const pages: DashboardPage[] = useMemo(() => {
        const live: Record<string, Partial<PageNav>> = {
            domainControllers: { badge: controllersBadge },
            activity: { badgeDot: activityTone !== undefined, badgeTone: activityTone },
        };

        return navEntries.map(({ id, path, ...entry }) => ({
            id,
            active: id === activeId,
            nav: { ...entry, ...live[id], onClick: () => navigate(path) },
        }));
    }, [controllersBadge, activityTone, navigate, activeId]);

    return (
        <StatusDotProvider live={!isLost}>
            <Dashboard
                logo={logo}
                title={brand}
                username={username}
                onLogout={logout}
                theme={theme}
                onToggleTheme={toggleTheme}
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={toggleSidebarCollapsed}
                pages={pages}
                navGroups={NAV_GROUPS}
                currentPath={pathname}
                banner={<ConnectionBanner connected={!isLost} />}
            >
                <BreadcrumbContext.Provider value={crumbs}>
                    <Suspense fallback={<LoadingIndicator />}>
                        <Outlet />
                    </Suspense>
                </BreadcrumbContext.Provider>
            </Dashboard>
        </StatusDotProvider>
    );
}
