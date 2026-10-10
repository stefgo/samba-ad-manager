import { useOutletContext } from "react-router-dom";
import type { Client } from "@sadm/shared";

/**
 * The client of the route above, for every route below a `ClientBoundary`. It has resolved
 * the client by then -- no route down here waits or checks again.
 */
export const useRouteClient = () => useOutletContext<Client>();
