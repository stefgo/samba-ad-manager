import { ReactNode } from "react";
import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { LoadingIndicator } from "@stefgo/react-ui-components";
import type { DomainController } from "@sadm/shared";

import Login from "../../pages/Login";
import { NotFoundCard } from "../../components/NotFoundCard";
import { QueryError } from "../../components/QueryError";
import { useAuth } from "../auth/AuthContext";
import { NotFoundError } from "../../lib/notFound";
import { ROUTES } from "../../lib/paths";
import { useDomainController, useDomainControllers } from "../../queries/domainControllers";
import { useRouteDomainController } from "./routeContext";
import { DomainControllerOverview, DomainControllers } from "./lazyPages";

// ---------------------------------------------------------------------------
// What the route tree in `routes.tsx` renders. Each element pulls what it needs
// from the query cache itself; none of them knows a path -- those come from
// `lib/paths.ts`, and "back" from the tree through `useBackPath`.
// ---------------------------------------------------------------------------

export function ProtectedRoute({ children }: { children: ReactNode }) {
    const { isAuthenticated } = useAuth();
    if (!isAuthenticated) {
        return <Navigate to={ROUTES.login} replace />;
    }
    return <>{children}</>;
}

export function LoginRoute() {
    const { isAuthenticated } = useAuth();
    return isAuthenticated ? <Navigate to={ROUTES.root} /> : <Login />;
}

export function NotFound() {
    const { pathname } = useLocation();

    return (
        <NotFoundCard title="Page not found" backTo={ROUTES.root} backLabel="Back to the dashboard">
            There is nothing at <code className="font-mono text-sm">{pathname}</code>.
        </NotFoundCard>
    );
}

// --- Domain controllers ---------------------------------------------------

export function DomainControllersRoute() {
    const { error } = useDomainControllers();

    // Instead of the list: an empty one would say the directory lists no domain controller.
    if (error) return <QueryError title="Could not load the domain controllers" error={error} />;

    return <DomainControllers />;
}

/**
 * The layout route of one domain controller (`ROUTES.domainController`): resolves it once
 * for everything below and hands it down as the outlet context (`useRouteDomainController`).
 *
 * It comes from the cached list. While that is pending this shows the spinner: a reloaded
 * or shared URL renders before the first fetch returns, and an empty list then says nothing
 * about whether the domain controller exists. Only after that is a missing one really gone
 * -- a stale bookmark, or one the directory no longer lists, gets the not-found card, and
 * the URL stays where it was.
 */
export function DomainControllerBoundary() {
    const { dcId } = useParams();
    const { isPending, error } = useDomainControllers();
    const dc = useDomainController(dcId);

    if (!dc) {
        // Not "not found": without the list nothing says whether it exists.
        if (error) return <QueryError title="Could not load the domain controller" error={error} />;
        if (isPending) return <LoadingIndicator label="Loading domain controller…" />;
        throw new NotFoundError("domainController");
    }
    return <Outlet context={dc satisfies DomainController} />;
}

export function DomainControllerDetailRoute() {
    return <DomainControllerOverview dc={useRouteDomainController()} />;
}
