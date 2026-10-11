import { useOutletContext } from "react-router-dom";
import type { DomainController } from "@sadm/shared";

/**
 * The domain controller of the route above, for every route below a
 * `DomainControllerBoundary`. It has resolved it by then -- no route down here waits or
 * checks again.
 */
export const useRouteDomainController = () => useOutletContext<DomainController>();
