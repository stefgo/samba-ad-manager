import { createContext, useContext } from "react";
import type { Crumb } from "../../../lib/breadcrumb";

// JSX-free by design -- see AuthContext.ts. `AppLayout` provides the trail it computes.
export const BreadcrumbContext = createContext<readonly Crumb[]>([]);

/** The trail to the open route, for a page that shows it in its own header. Empty on a list. */
export const useCrumbs = () => useContext(BreadcrumbContext);
