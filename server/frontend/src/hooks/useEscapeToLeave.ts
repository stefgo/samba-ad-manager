import { useEffect } from "react";
import { useNavigate, type To } from "react-router-dom";

/** Whether the key went to a field that may want Escape for itself, or that is being typed in. */
const isEditing = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Escape leaves a detail page for `to`, the list that opened it.
 *
 * Not while something else is using Escape: a confirmation, an open menu or an autocomplete
 * handles its own Escape and stops the event there. And not while the focus is in a field:
 * every detail page has a list with a search box, and Escape in it used to leave the whole
 * page instead of just the typing.
 */
export function useEscapeToLeave(to: To): void {
    const navigate = useNavigate();

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented || isEditing(e.target)) return;
            navigate(to);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [navigate, to]);
}
