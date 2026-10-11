export const APP_NAME = "SADM";

/** What a route's subject is, for the routes whose title is the name of something. */
export type TitleSubject = "domainController";

/** The part of a route's `handle` the title is read from. */
export interface TitleHandle {
    /** An area of the sidebar: its label is the title of everything below it. */
    nav?: { label: string };
    /** What the route is called when it has no subject, or its subject has no name yet. */
    title?: string;
    /** The route is about one domain controller, and is called by its name. */
    subject?: TitleSubject;
}

/**
 * The document title, from the parts that name the page -- most specific first, so a
 * narrow browser tab cuts the application's name and not the subject:
 * `DC1 · Domain Controllers · SADM`.
 */
export const pageTitle = (parts: readonly (string | null | undefined)[]): string =>
    [...parts.filter((part) => !!part), APP_NAME].join(" · ");

/**
 * What a route is called by itself: the name of its subject, or else its own title.
 * `nameOf` resolves a subject from what is cached; while it cannot, the title stands in.
 * Shared with the breadcrumb (`lib/breadcrumb.ts`), so the two never name a page differently.
 */
export const ownName = (
    handle: TitleHandle,
    nameOf: (subject: TitleSubject) => string | undefined,
): string | undefined => (handle.subject && nameOf(handle.subject)) || handle.title;

/**
 * The title of the open route, read off the handles of its matches, outermost first --
 * the area, then what lies below it. Each route adds at most two parts: the area's label,
 * and its subject's name or else its own title.
 *
 * `nameOf` resolves a subject from what is cached; while it cannot, the route's `title`
 * stands in, so a reloaded page is called "Domain Controller" before it is called "DC1".
 */
export function routeTitle(
    handles: readonly (TitleHandle | undefined)[],
    nameOf: (subject: TitleSubject) => string | undefined,
): string {
    const parts = handles.flatMap((handle) => {
        if (!handle) return [];
        return [handle.nav?.label, ownName(handle, nameOf)];
    });
    return pageTitle(parts.reverse());
}
