import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { parentCrumb } from "../../lib/breadcrumb";
import { useCrumbs } from "./context/BreadcrumbContext";

const LINK =
    "rounded font-normal text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

interface HeaderBreadcrumbProps {
    /** The page's heading: what is shown where there is no trail. */
    children: ReactNode;
    /**
     * What the open page is called here, where the trail's own word for it says less than
     * the heading did -- an image below a client is "Image" in the trail.
     */
    current?: ReactNode;
}

/**
 * The visible way back: the trail as the heading of a page's first card, in place of its title:
 * `Domain Controllers › dc1 › Edit`, the open page in the heading's own weight and
 * what leads to it lighter. A narrow screen keeps the heading the page had before -- the
 * trail's last word may be a host, and alone it would not say what the page is about --
 * behind a `‹` that leads to the link above the open page.
 *
 * The size is the heading's own, set where every heading's is: the `classNames` of the card
 * or header this is the title of.
 *
 * Every link is a router link, so leaving a changed editor through one is asked about like
 * any other way out (`useUnsavedChangesGuard`).
 */
export function HeaderBreadcrumb({ children, current }: HeaderBreadcrumbProps) {
    const crumbs = useCrumbs();
    if (crumbs.length === 0) return <>{children}</>;

    const parent = parentCrumb(crumbs);

    return (
        <>
            <span className="flex min-w-0 items-center gap-1 sm:hidden">
                {parent && (
                    <Link to={parent.to} aria-label={`Back to ${parent.label}`} className={`${LINK} -ml-1 shrink-0`}>
                        <ChevronLeft size={18} aria-hidden />
                    </Link>
                )}
                <span className="truncate">{children}</span>
            </span>
            <span className="hidden min-w-0 items-center gap-2 sm:flex">
                {crumbs.map((crumb, i) => {
                    const isCurrent = i === crumbs.length - 1;
                    return (
                        // The trail is a path: a position names a link, and two may share a label.
                        <span key={i} className="flex min-w-0 items-center gap-2">
                            {i > 0 && <ChevronRight size={14} className="shrink-0 text-text-muted" aria-hidden />}
                            {isCurrent ? (
                                <span className="truncate" aria-current="page">
                                    {current ?? crumb.label}
                                </span>
                            ) : crumb.to ? (
                                <Link to={crumb.to} className={`${LINK} truncate`}>
                                    {crumb.label}
                                </Link>
                            ) : (
                                <span className="truncate font-normal text-text-muted">{crumb.label}</span>
                            )}
                        </span>
                    );
                })}
            </span>
        </>
    );
}
