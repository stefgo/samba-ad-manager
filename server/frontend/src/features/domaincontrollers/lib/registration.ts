import type { DomainController } from "@sadm/shared";

/** Whether a registration token is open for a domain controller's agent, ran out, or was never issued (or was used). */
export type RegistrationTokenState = "open" | "expired" | "none";

export function registrationTokenState(dc: Pick<DomainController, "agentRegistrationExpiresAt">, now: number): RegistrationTokenState {
    if (!dc.agentRegistrationExpiresAt) return "none";
    return Date.parse(dc.agentRegistrationExpiresAt) > now ? "open" : "expired";
}

/**
 * A domain controller that waits for its agent: it has none, and the token one registers
 * with is still good. Once the token has run out it waits for nothing -- a new one is needed.
 */
export const awaitsRegistration = (dc: Pick<DomainController, "agent" | "agentRegistrationExpiresAt">, now: number): boolean =>
    dc.agent === null && registrationTokenState(dc, now) === "open";

/** The ids of the domain controllers that wait for their agent. */
export const awaitingRegistration = (dcs: readonly DomainController[], now: number): ReadonlySet<string> =>
    new Set(dcs.filter((dc) => awaitsRegistration(dc, now)).map((dc) => dc.id));
