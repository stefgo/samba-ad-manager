import type { DnsRecordData } from "@sadm/shared";

/**
 * Which names and records of a zone the domain cannot do without.
 *
 * They are the ones the domain controllers register for themselves: what a client finds a
 * domain controller by, and what the domain controllers find each other by. They are shown
 * like any other and are not changed from here -- a wrong one takes the domain down, and
 * the domain controller that owns it would put it back anyway.
 */

const lower = (name: string) => name.toLowerCase();

/** The names every DNS server of the domain answers under: the DNS partitions themselves. */
const PARTITION_NAMES = new Set(["domaindnszones", "forestdnszones"]);

/**
 * A name where nothing is changed and nothing is added:
 *
 * - `@`, the zone itself: its SOA and name servers, and the addresses of the domain,
 * - every name with a label that starts with `_` -- `_ldap._tcp`, `_kerberos._udp`,
 *   `_msdcs`, `_sites` and all that lives below them,
 * - everything in the zone `_msdcs.<forest>`,
 * - `DomainDnsZones` and `ForestDnsZones`.
 */
export function isProtectedNode(zoneName: string, nodeName: string): boolean {
    if (nodeName === "@") return true;
    if (lower(zoneName).startsWith("_msdcs.")) return true;
    const labels = lower(nodeName).split(".");
    if (labels.some((label) => label.startsWith("_"))) return true;
    return PARTITION_NAMES.has(labels[labels.length - 1]);
}

/**
 * A record that is not changed at a name that otherwise can be: the addresses under a
 * domain controller's own name. Anything else there -- a text record, say -- is the
 * operator's.
 */
export function isProtectedRecord(fqdn: string, data: Pick<DnsRecordData, "type">, dcHostNames: ReadonlySet<string>): boolean {
    return (data.type === "A" || data.type === "AAAA") && dcHostNames.has(lower(fqdn));
}

/** The host names of the domain controllers, in the form `isProtectedRecord` compares against. */
export const dcHostNameSet = (names: readonly (string | null | undefined)[]): ReadonlySet<string> =>
    new Set(names.filter((name): name is string => !!name).map((name) => lower(name).replace(/\.$/, "")));
