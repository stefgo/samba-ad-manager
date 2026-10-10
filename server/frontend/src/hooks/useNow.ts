import { useSyncExternalStore } from "react";

/** How often a derived duration moves on. Coarse on purpose: it is read, not timed. */
const TICK_MS = 30_000;

// One clock for the whole page: every component that shows a running duration reads the same
// value and re-renders on the same tick, instead of each keeping an interval of its own. The
// interval runs only while something is subscribed.
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (!timer) {
        now = Date.now();
        timer = setInterval(() => {
            now = Date.now();
            listeners.forEach((l) => l());
        }, TICK_MS);
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
            clearInterval(timer);
            timer = null;
        }
    };
}

const getSnapshot = () => now;

/**
 * The current time, moving on every `TICK_MS`. What a component reads when it shows how long
 * ago something happened: `Date.now()` during render is impure, and a value computed once
 * would stand still until something else re-rendered it.
 */
export function useNow(): number {
    return useSyncExternalStore(subscribe, getSnapshot);
}
