import { useEffect } from "react";
import { isSearchHotkey } from "../lib/searchHotkey";

/**
 * `/` puts the cursor into the search of the list on screen. One listener for the whole
 * shell rather than one per list: every list's search is a `searchbox`, so the first one
 * that is visible is the one the reader is looking at. While a dialog is open the key is
 * the dialog's; with no list on screen nothing happens and the key is left alone.
 */
export function useSearchHotkey(): void {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!isSearchHotkey(event, event.target instanceof Element ? event.target as HTMLElement : null)) return;
            if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
            const search = [...document.querySelectorAll<HTMLInputElement>('[role="searchbox"]')]
                .find((input) => input.getClientRects().length > 0);
            if (!search) return;
            // Otherwise the slash that asked for the field ends up in it.
            event.preventDefault();
            search.focus();
            search.select();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);
}
