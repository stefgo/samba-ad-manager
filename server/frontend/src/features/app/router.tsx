import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "./AppLayout";
import { LoginRoute, ProtectedRoute } from "./routeElements";
import { shellRoutes } from "./routes";
import { ROUTES } from "../../lib/paths";

/**
 * `/login` stands alone; everything else lives behind `ProtectedRoute` inside the
 * dashboard shell, whose pages are the tree in `routes.tsx`.
 */
export const router = createBrowserRouter([
    { path: ROUTES.login, element: <LoginRoute /> },
    {
        element: (
            <ProtectedRoute>
                <AppLayout />
            </ProtectedRoute>
        ),
        children: shellRoutes,
    },
]);
