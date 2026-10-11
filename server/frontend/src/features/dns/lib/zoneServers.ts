import { highestSerial, type DomainHealth } from "@sadm/shared";

/**
 * How one name server stands with one zone.
 *
 * - `in-step`: it serves the zone with the serial number the domain controllers have.
 * - `catching-up`: it serves another one, for no longer than the zone gives it.
 * - `behind`, `ahead`: it has served another one for longer -- a finding.
 * - `down`: it does not answer for the zone.
 */
export type ZoneServerState = "in-step" | "catching-up" | "behind" | "ahead" | "down";

export interface ZoneServer {
    /** A domain controller's name, or a name server's host name. */
    name: string;
    kind: "domain-controller" | "secondary";
    /** A domain controller's id, for a link to its page. */
    dcId?: string;
    state: ZoneServerState;
    serial: number | null;
    /** Why it does not answer, or since when it has been out of step. */
    detail: string | null;
    outOfSyncSince: string | null;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Every server that was asked about a zone, the domain controllers first: what each serves
 * and how that stands against the others. Read off the domain's health, so that this and
 * the findings on the dashboard are one judgement.
 *
 * `zone.nameServers` is what the zone lists: a secondary that does not answer at all was
 * asked about no zone, and belongs to the ones that name it.
 *
 * Empty before the zones were first asked for, which is a few minutes after the server's start.
 */
export function zoneServers(
    domain: Pick<DomainHealth, "controllers" | "nameServers" | "issues">,
    zone: { name: string; nameServers: readonly string[] },
): ZoneServer[] {
    const zoneName = zone.name;
    const asked = domain.controllers.flatMap((dc) => {
        const answer = dc.health?.dns?.zones.find((zone) => same(zone.zone, zoneName));
        return answer ? [{ dc, answer }] : [];
    });
    const reference = highestSerial(asked.flatMap(({ answer }) => (answer.ok && typeof answer.serial === "number" ? [answer.serial] : [])));

    const servers: ZoneServer[] = asked.map(({ dc, answer }) => ({
        name: dc.name,
        kind: "domain-controller",
        dcId: dc.id,
        // A domain controller with another serial number has not replicated the change yet; whether that hangs is replication's finding.
        state: !answer.ok ? "down" : answer.serial === reference ? "in-step" : "catching-up",
        serial: answer.serial ?? null,
        detail: answer.ok ? null : (answer.detail ?? null),
        outOfSyncSince: null,
    }));

    for (const server of domain.nameServers) {
        const answer = server.zones.find((zone) => same(zone.zone, zoneName));
        if (!answer && (server.ok || !zone.nameServers.some((listed) => same(listed.replace(/\.$/, ""), server.name)))) continue;
        const about = `${server.name}/${zoneName.toLowerCase()}`;
        const finding = domain.issues.find((issue) => issue.id.endsWith(`||${about}`));
        const state: ZoneServerState =
            !server.ok || !answer?.ok
                ? "down"
                : finding?.type === "dns-secondary-behind"
                  ? "behind"
                  : finding?.type === "dns-secondary-ahead"
                    ? "ahead"
                    : answer.outOfSyncSince
                      ? "catching-up"
                      : "in-step";
        servers.push({
            name: server.name,
            kind: "secondary",
            state,
            serial: answer?.serial ?? null,
            detail: !server.ok ? (server.detail ?? null) : answer && !answer.ok ? (answer.detail ?? null) : null,
            outOfSyncSince: answer?.outOfSyncSince ?? null,
        });
    }
    return servers;
}

/** The worst state among some servers, for one badge that speaks for all of them; null for none. */
export function worstZoneState(servers: readonly ZoneServer[]): ZoneServerState | null {
    const order: ZoneServerState[] = ["down", "behind", "ahead", "catching-up", "in-step"];
    return order.find((state) => servers.some((server) => server.state === state)) ?? null;
}

export const ZONE_STATE_LABELS: Record<ZoneServerState, string> = {
    "in-step": "In step",
    "catching-up": "Catching up",
    behind: "Behind",
    ahead: "Ahead",
    down: "Not answering",
};

/** How a state is coloured: a finding as what it is, a wait as nothing to worry about. */
export const ZONE_STATE_TONES: Record<ZoneServerState, "success" | "neutral" | "warning" | "error"> = {
    "in-step": "success",
    "catching-up": "neutral",
    behind: "warning",
    ahead: "warning",
    down: "error",
};
