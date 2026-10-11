import { useMemo } from "react";
import { buildDomainHealth, type DomainHealth } from "@sadm/shared";
import { useNow } from "../../../hooks/useNow";
import { useDomainControllers } from "../../../queries/domainControllers";
import { useQuery } from "@tanstack/react-query";
import { domainHealthOptionsQuery, useDcHealthStates } from "../../../queries/dcHealth";

/**
 * The domain as a whole, derived from the domain controllers the directory lists and what
 * is known of each -- by the function the server's events use, so the two cannot disagree. `now` moves with
 * the shared clock, so "last replicated two hours ago" turns into a finding without a new
 * measurement having to arrive.
 */
export function useDomainHealth(): { domain: DomainHealth; isPending: boolean; error: unknown } {
    const { domainControllers, isPending: listPending, error: listError } = useDomainControllers();
    const { states, isPending: statesPending, error: statesError } = useDcHealthStates();
    const { data: thresholds } = useQuery(domainHealthOptionsQuery);
    const now = useNow();
    // To the minute: the ages are compared against thresholds of minutes, and a new object
    // every second would re-render every view of the domain for nothing.
    const minute = Math.floor(now / 60_000) * 60_000;
    const domain = useMemo(
        () => buildDomainHealth(domainControllers, states, { ...thresholds, now: minute }),
        [domainControllers, states, thresholds, minute],
    );
    return { domain, isPending: listPending || statesPending, error: listError ?? statesError };
}
