import { useCallback, useEffect, useRef } from "react";
import { useBlocker, useNavigate, type BlockerFunction, type NavigateOptions, type To } from "react-router-dom";
import { useConfirm } from "@stefgo/react-ui-components";
import { describeDiscardChanges, type DiscardEditor } from "../components/confirmations";
import { useBackPath } from "./useBackPath";

interface GuardOptions {
    /**
     * Asked before Escape closes the page. Returns `true` when the key was used up -- an
     * open sub-list closed back into the form -- so the page stays.
     */
    onEscape?: () => boolean;
}

/**
 * The one place an editor's unsaved work is asked about. Every way out of the page goes
 * through the router's blocker -- the X in the header, Escape, an entry in the sidebar,
 * the browser's back button -- so they all ask the same question, once.
 *
 * - `close` leaves for the parent in the route tree and is asked about while dirty.
 * - `leave` does the same without the question, for the navigation that follows a save:
 *   the form's state is only clean on the next render, and the blocker would still see
 *   the one before. It takes another target when the save leads somewhere else than back,
 *   such as the page of what was just created.
 *
 * A reload or a closed tab is not a navigation the router sees; the browser's own prompt
 * covers those.
 */
export function useUnsavedChangesGuard(isDirty: boolean, editor: DiscardEditor, { onEscape }: GuardOptions = {}) {
    const navigate = useNavigate();
    const back = useBackPath();
    const { confirm } = useConfirm();

    // Read by the blocker when a navigation starts, which is not during a render.
    const dirty = useRef(isDirty);
    useEffect(() => {
        dirty.current = isDirty;
    }, [isDirty]);
    const unasked = useRef(false);

    const shouldBlock = useCallback<BlockerFunction>(
        ({ currentLocation, nextLocation }) =>
            dirty.current && !unasked.current && currentLocation.pathname !== nextLocation.pathname,
        [],
    );
    const blocker = useBlocker(shouldBlock);

    // One question per blocked navigation. The effect runs again whenever the blocker
    // changes, and a second dialog behind the first would answer for a navigation that
    // is already decided.
    const asking = useRef(false);
    useEffect(() => {
        if (blocker.state !== "blocked" || asking.current) return;
        asking.current = true;
        void confirm(describeDiscardChanges(editor)).then((discard) => {
            asking.current = false;
            if (discard) blocker.proceed();
            else blocker.reset();
        });
    }, [blocker, confirm, editor]);

    useEffect(() => {
        if (!isDirty) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [isDirty]);

    const close = useCallback(() => {
        navigate(back);
    }, [navigate, back]);

    const leave = useCallback(
        (to: To = back, options?: NavigateOptions) => {
            unasked.current = true;
            navigate(to, options);
        },
        [navigate, back],
    );

    // Escape does what the header's X does -- including asking first.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            // Not while a select, a dialog or an autocomplete is using Escape for itself --
            // this includes the discard confirmation, which closes on its own Escape.
            if (e.key !== "Escape" || e.defaultPrevented || asking.current) return;
            if (onEscape?.()) return;
            close();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [close, onEscape]);

    return { close, leave };
}
