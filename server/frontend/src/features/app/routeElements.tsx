import { ReactNode } from "react";
import { Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { LoadingIndicator } from "@stefgo/react-ui-components";
import type { Client } from "@sadm/shared";

import Login from "../../pages/Login";
import { NotFoundCard } from "../../components/NotFoundCard";
import { QueryError } from "../../components/QueryError";
import { useAuth } from "../auth/AuthContext";
import { NotFoundError } from "../../lib/notFound";
import { ROUTES, paths } from "../../lib/paths";
import { queryClient } from "../../lib/queryClient";
import {
    useClient,
    useClients,
    useCreateOutboundClient,
    useDeleteClient,
    useUpdateClient,
} from "../../queries/clients";
import { tokenListOptions } from "../../queries/tokens";
import { useRouteClient } from "./routeContext";
import { AddClientWizard, ClientEditor, ClientOverview, ManagedClients } from "./lazyPages";

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

// --- Clients ---------------------------------------------------------------

export function ClientsRoute() {
    const navigate = useNavigate();
    const { clients, error, refetch } = useClients();
    const deleteClient = useDeleteClient();

    // Instead of the list: an empty one would say no client is registered.
    if (error) return <QueryError title="Could not load the domain controllers" error={error} />;

    return (
        <ManagedClients
            clients={clients}
            onSelect={(c) => navigate(c ? paths.client(c.id) : ROUTES.clients)}
            onRefresh={() => {
                void refetch();
            }}
            onDelete={(id) => deleteClient.mutateAsync(id)}
            onAdd={() => navigate(ROUTES.clientNew)}
            onEdit={(c) => navigate(paths.clientEdit(c.id))}
        />
    );
}

export function AddClientRoute() {
    const createOutboundClient = useCreateOutboundClient();

    return (
        <AddClientWizard
            onCreateOutbound={(data) => createOutboundClient.mutateAsync(data)}
            onTokenCreated={() => void queryClient.invalidateQueries({ queryKey: tokenListOptions.queryKey })}
        />
    );
}

/**
 * The layout route of one client (`ROUTES.client`): resolves the client once for everything below
 * it and hands it down as the outlet context (`useRouteClient`).
 *
 * The client comes from the cached list. While that is pending this shows the spinner: a
 * reloaded or shared URL renders before the first fetch returns, and an empty list then
 * says nothing about whether the client exists. Only after that is a missing client
 * really gone -- a stale bookmark or a deleted client gets the not-found card, and the URL
 * stays where it was. The routes used to show the client list in both cases, under an
 * address that named a client.
 */
export function ClientBoundary() {
    const { clientId } = useParams();
    const { isPending, error } = useClients();
    const client = useClient(clientId);

    if (!client) {
        // Not "not found": without the list nothing says whether the client exists.
        if (error) return <QueryError title="Could not load the domain controller" error={error} />;
        if (isPending) return <LoadingIndicator label="Loading domain controller…" />;
        throw new NotFoundError("client");
    }
    return <Outlet context={client satisfies Client} />;
}

export function ClientDetailRoute() {
    return <ClientOverview client={useRouteClient()} />;
}

export function ClientEditRoute() {
    const client = useRouteClient();
    // Optimistic: the list shows the change at once and takes it back if the server refuses.
    const { mutateAsync: updateClient } = useUpdateClient();

    return <ClientEditor client={client} onSave={(clientId, data) => updateClient({ clientId, data })} />;
}

