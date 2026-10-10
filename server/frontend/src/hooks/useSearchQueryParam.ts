import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { SEARCH_PARAM } from "../lib/paths";

/**
 * A single query parameter as state, kept in the URL so it survives a reload and travels
 * with a shared link.
 *
 * It merges rather than replaces. `setSearchParams({ x })` -- the shape this started out as
 * -- drops every other parameter, which is invisible while a page has only one, and turns
 * into two features deleting each other the moment it has two: a list's `search` and the
 * tab it sits behind were exactly that pair.
 *
 * Writes `replace` the history entry. Typing into a search field is not a destination, and
 * a character-by-character history would make the back button spell the query backwards.
 *
 * An empty value removes the parameter instead of writing `?search=`, so a cleared field
 * leaves the URL as clean as it found it.
 */
export function useSearchQueryParam(key = SEARCH_PARAM): [string, (value: string) => void] {
    const [searchParams, setSearchParams] = useSearchParams();
    const value = searchParams.get(key) ?? "";

    const setValue = useCallback(
        (next: string) => {
            setSearchParams(
                (prev) => {
                    const params = new URLSearchParams(prev);
                    if (next) {
                        params.set(key, next);
                    } else {
                        params.delete(key);
                    }
                    return params;
                },
                { replace: true },
            );
        },
        [key, setSearchParams],
    );

    return [value, setValue];
}
