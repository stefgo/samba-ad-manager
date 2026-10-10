import { useMemo } from "react";
import { buildDomainHealth, type DomainHealth } from "@sadm/shared";
import { useNow } from "../../../hooks/useNow";
import { useClients } from "../../../queries/clients";
import { useDcHealthStates } from "../../../queries/dcHealth";

/**
 * The domain as a whole, derived from the client list and every client's last measurement
 * -- by the function the server's events use, so the two cannot disagree. `now` moves with
 * the shared clock, so "last replicated two hours ago" turns into a finding without a new
 * measurement having to arrive.
 */
export function useDomainHealth(): { domain: DomainHealth; isPending: boolean; error: unknown } {
    const { clients, isPending: clientsPending, error: clientsError } = useClients();
    const { states, isPending: statesPending, error: statesError } = useDcHealthStates();
    const now = useNow();
    // To the minute: the ages are compared against thresholds of minutes, and a new object
    // every second would re-render every view of the domain for nothing.
    const minute = Math.floor(now / 60_000) * 60_000;
    const domain = useMemo(() => buildDomainHealth(clients, states, { now: minute }), [clients, states, minute]);
    return { domain, isPending: clientsPending || statesPending, error: clientsError ?? statesError };
}
