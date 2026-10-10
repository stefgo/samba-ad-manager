import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@stefgo/react-ui-components";
import { activityListOptions } from "../../../queries/activity";
import { problemToasts, toastKey } from "../lib/problemToasts";

/**
 * Turns an error or a warning that arrives while the dashboard is open into a toast, on
 * whatever page the reader is. Mounted once, in the shell: the sidebar's dot says that
 * something needs a look, this says what, to somebody looking at another page.
 *
 * No clock decides what is new. The list as it first arrives is what was there before, and
 * is the activity page's to show; every event that joins it later is new. That holds for a
 * list delivered whole after a reconnect too -- what happened while the socket was down is
 * news -- and `problemToasts` folds a long one into a single toast.
 */
export function useProblemToasts(): void {
    const { show } = useToast();
    const events = useQuery(activityListOptions).data;
    /** Every key the list has held; null until the list has arrived once. */
    const known = useRef<Set<string> | null>(null);

    useEffect(() => {
        if (!events) return;
        if (known.current === null) {
            known.current = new Set(events.map(toastKey));
            return;
        }
        const toasts = problemToasts(events, known.current);
        for (const event of events) known.current.add(toastKey(event));
        for (const { variant, title, description, sticky } of toasts) {
            show({ variant, title, description, ...(sticky ? { duration: 0 } : {}) });
        }
    }, [events, show]);
}
