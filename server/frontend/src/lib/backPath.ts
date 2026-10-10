/** `/clients/` and `/clients` are the same place -- an index route matches with the slash. */
const trimmed = (pathname: string) =>
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

/**
 * Where "back" is for the page at the end of a chain of route matches: the nearest
 * ancestor in the route tree that is another place.
 *
 * `pathnames` is what `useMatches()` yields, outermost first. A layout route without a
 * path and an index route both repeat their parent's pathname, so the answer is the last
 * pathname that differs from the current one, not simply the one before it.
 */
export function parentPath(pathnames: readonly string[]): string {
    if (pathnames.length === 0) return "/";
    const current = trimmed(pathnames[pathnames.length - 1]);
    for (let i = pathnames.length - 2; i >= 0; i--) {
        const candidate = trimmed(pathnames[i]);
        if (candidate !== current) return candidate;
    }
    return "/";
}
