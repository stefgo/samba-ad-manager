import type { DnsNode, DnsRecord, DnsZone, DnsZonePartition } from "@sadm/shared";
import { dnsRecordText, dnsRecordTypeLabel } from "@sadm/shared";

/** Where a zone is kept, as a reader is told. */
export const PARTITION_LABELS: Record<DnsZonePartition, string> = {
    domain: "Domain",
    forest: "Forest",
    legacy: "Domain partition",
};

/** What "kept in" means for each, for whoever asks. */
export const PARTITION_HINTS: Record<DnsZonePartition, string> = {
    domain: "Replicated to every DNS server of the domain.",
    forest: "Replicated to every DNS server of the forest.",
    legacy: "Kept in the domain partition itself, where a domain that was upgraded from an old one has its zones.",
};

/** A zone that maps addresses back to names. */
export const isReverseZone = (zone: Pick<DnsZone, "name">): boolean => /\.(in-addr|ip6)\.arpa$/i.test(zone.name);

/** One record of a zone as a row: the record with the name it belongs to. */
export interface RecordRow {
    /** Unique within the zone: the name's GUID and the record's place among its records. */
    key: string;
    node: DnsNode;
    record: DnsRecord;
    type: string;
    text: string;
}

/** A zone's records, one row each. A name with three records is three rows. */
export function recordRows(nodes: readonly DnsNode[]): RecordRow[] {
    return nodes.flatMap((node) =>
        node.records.map((record, index) => ({
            key: `${node.guid}|${index}`,
            node,
            record,
            type: dnsRecordTypeLabel(record.data),
            text: dnsRecordText(record.data),
        })),
    );
}

/** Whether a row is one a search for `query` means: by name, by type, or by what the record says. */
export function matchesRecordSearch(row: RecordRow, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [row.node.name, row.node.fqdn, row.type, row.text].some((value) => value.toLowerCase().includes(q));
}

/** The name a list sorts by: the zone itself first, then by name. */
export const recordSortName = (row: RecordRow): string => (row.node.name === "@" ? "" : row.node.name.toLowerCase());
