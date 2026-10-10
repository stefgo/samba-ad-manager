import { ownName, type TitleHandle, type TitleSubject } from "./pageTitle";

/** One link of the trail. The last has no `to`: it is the page that is open. */
export interface Crumb {
    label: string;
    to?: string;
}

/** What `useMatches()` yields, as far as the trail needs it. */
export interface CrumbMatch {
    pathname: string;
    handle?: TitleHandle;
}

/**
 * The trail to the open route, read off the handles of its matches like the document
 * title, outermost first: the area, then what lies below it. Each link leads to the route
 * that named it; the last one is the open page and leads nowhere.
 *
 * `nameOf` resolves a subject from what is cached -- the same answer the document title
 * gets, so the two never name a page differently.
 *
 * Empty for a page with nothing above it -- a list, the overview -- so only a route below
 * a list shows a trail.
 */
export function breadcrumb(
    matches: readonly CrumbMatch[],
    nameOf: (subject: TitleSubject) => string | undefined,
): Crumb[] {
    const crumbs = matches.flatMap(({ pathname, handle }): Crumb[] => {
        if (!handle) return [];
        const area = handle.nav ? [{ label: handle.nav.label, to: pathname }] : [];
        const own = ownName(handle, nameOf);
        return own ? [...area, { label: own, to: pathname }] : area;
    });

    if (crumbs.length < 2) return [];
    return crumbs.map((crumb, i) => (i === crumbs.length - 1 ? { label: crumb.label } : crumb));
}

/**
 * The one link a narrow screen keeps: the nearest one above the open page that leads
 * somewhere.
 */
export function parentCrumb(crumbs: readonly Crumb[]): (Crumb & { to: string }) | undefined {
    for (let i = crumbs.length - 2; i >= 0; i--) {
        const { label, to } = crumbs[i];
        if (to) return { label, to };
    }
    return undefined;
}
