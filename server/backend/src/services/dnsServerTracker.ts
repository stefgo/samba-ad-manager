import type { DnsServerHealth } from "@sadm/shared";

type ZoneState = DnsServerHealth["zones"][number];

/** One zone as a name server just answered for it, before it is compared with anything. */
export type ZoneAnswer = Omit<ZoneState, "referenceSerial" | "outOfSyncSince">;

/**
 * Since when a name server has been out of step with the domain controllers, for each zone
 * it answered for.
 *
 * "Out of step" is having another serial number than the highest a domain controller
 * serves. That alone says little: after every change a secondary is behind until it next
 * asks, and a zone that changes all the time is never caught up with for long. What counts
 * is a secondary whose own serial number does not move while it differs -- so the wait
 * starts when a difference is first seen and starts again whenever the secondary's number
 * changes. Whether the wait has been too long is `buildDomainHealth`'s to say.
 *
 * `previous` is the server as it was last measured, `references` the highest serial number
 * of each zone (by lower-case name) among the domain controllers right now.
 */
export function trackOutOfSync(
    previous: DnsServerHealth | null,
    answers: readonly ZoneAnswer[],
    references: ReadonlyMap<string, number>,
    now: string,
): ZoneState[] {
    const before = new Map(previous?.zones.map((zone) => [zone.zone.toLowerCase(), zone]));
    return answers.map((answer) => {
        const referenceSerial = references.get(answer.zone.toLowerCase()) ?? null;
        const inStep = !answer.ok || typeof answer.serial !== "number" || referenceSerial === null || answer.serial === referenceSerial;
        if (inStep) return { ...answer, referenceSerial, outOfSyncSince: null };

        const last = before.get(answer.zone.toLowerCase());
        const stillStuck = !!last?.outOfSyncSince && last.serial === answer.serial;
        return { ...answer, referenceSerial, outOfSyncSince: stillStuck ? last.outOfSyncSince : now };
    });
}

/** The highest serial number the domain controllers serve for each zone, by lower-case zone name. */
export function referenceSerials(
    measured: readonly { zones: readonly { zone: string; ok: boolean; serial?: number | null }[] }[],
    highest: (serials: readonly number[]) => number | null,
): Map<string, number> {
    const byZone = new Map<string, number[]>();
    for (const { zones } of measured) {
        for (const zone of zones) {
            if (!zone.ok || typeof zone.serial !== "number") continue;
            const key = zone.zone.toLowerCase();
            byZone.set(key, [...(byZone.get(key) ?? []), zone.serial]);
        }
    }
    const references = new Map<string, number>();
    for (const [zone, serials] of byZone) {
        const top = highest(serials);
        if (top !== null) references.set(zone, top);
    }
    return references;
}

export interface NameServerToAsk {
    name: string;
    source: "ns" | "config";
    zones: string[];
}

/**
 * Which name servers there are to ask, and for which zones: every server a zone lists that
 * is no domain controller, with the zones that list it, and every server the configuration
 * names, with every zone there is -- it is kept for the ones it answers for.
 *
 * A name is compared without its case and without a dot at its end.
 */
export function nameServersToAsk(
    zones: readonly { zone: string; nameServers: readonly string[] }[],
    dcHostNames: readonly (string | null | undefined)[],
    configured: readonly string[],
): NameServerToAsk[] {
    const host = (name: string) => name.trim().toLowerCase().replace(/\.$/, "");
    const controllers = new Set(dcHostNames.filter((name): name is string => !!name).map(host));
    const allZones = [...new Set(zones.map((zone) => zone.zone.toLowerCase()))].sort();

    const listed = new Map<string, Set<string>>();
    for (const { zone, nameServers } of zones) {
        for (const server of nameServers.map(host)) {
            if (!server || controllers.has(server)) continue;
            listed.set(server, (listed.get(server) ?? new Set()).add(zone.toLowerCase()));
        }
    }

    const servers: NameServerToAsk[] = [...listed].map(([name, of]) => ({ name, source: "ns", zones: [...of].sort() }));
    for (const name of [...new Set(configured.map(host))]) {
        // One a zone lists is asked as that: for the zones it is responsible for.
        if (!name || listed.has(name) || controllers.has(name)) continue;
        servers.push({ name, source: "config", zones: allZones });
    }
    return servers.sort((a, b) => a.name.localeCompare(b.name));
}
