import type { DnsRecordData } from "@sadm/shared";

/**
 * One value of `dnsRecord`: one record of a name, as the directory keeps it on a `dnsNode`.
 *
 * The layout is `dnsp_DnssrvRpcRecord` (Samba's `dnsp.idl`, which follows MS-DNSP 2.3.2.2):
 * a fixed head of 24 bytes and the record's data behind it. The head is little-endian --
 * except the TTL, which is big-endian, as is everything inside the data: there the record
 * is written the way it goes over the wire.
 *
 *     0  uint16  wDataLength    the length of what follows the head
 *     2  uint16  wType          the record type; 0 is a tombstone
 *     4  uint8   version        5
 *     5  uint8   rank           0xF0 for a record of the zone itself
 *     6  uint16  flags          0
 *     8  uint32  dwSerial       the zone's serial number when the record was written
 *    12  uint32  dwTtlSeconds   big-endian
 *    16  uint32  dwReserved
 *    20  uint32  dwTimeStamp    hours since 1601-01-01; 0 for a record that does not age
 *    24  ...     data
 *
 * A host name in the data is not in wire format but a `DNS_COUNT_NAME`: its length in
 * bytes, the number of its labels, each label behind a length byte, and a zero.
 */
export interface DnsRecordHead {
    rank: number;
    flags: number;
    /** The zone's serial number when the record was written. */
    serial: number;
    ttl: number;
    reserved: number;
    /** Hours since 1601-01-01; 0 for a record somebody entered. */
    timestamp: number;
}

/** A name that was deleted and is kept until the directory forgets it. */
export interface DnsTombstone {
    type: "tombstone";
}

export interface DecodedDnsRecord {
    head: DnsRecordHead;
    data: DnsRecordData | DnsTombstone;
}

const HEAD_LENGTH = 24;

export const DNS_TYPE_CODES = {
    A: 1,
    NS: 2,
    CNAME: 5,
    SOA: 6,
    PTR: 12,
    MX: 15,
    TXT: 16,
    AAAA: 28,
    SRV: 33,
} as const;

/** Hours between 1601-01-01 and 1970-01-01. */
const EPOCH_OFFSET_HOURS = 3_234_576;

/** A record's time stamp as ISO 8601; null for 0, which is a record that does not age. */
export function isoOfDnsTimestamp(hours: number): string | null {
    if (hours <= 0) return null;
    const date = new Date((hours - EPOCH_OFFSET_HOURS) * 3_600_000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Walks the data of one record. Every read past its end throws, which `decodeDnsRecord` turns into null. */
class Reader {
    private offset = 0;
    private readonly view: DataView;

    constructor(private readonly bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    get done(): boolean {
        return this.offset >= this.bytes.length;
    }

    private take(length: number): number {
        if (this.offset + length > this.bytes.length) throw new RangeError("The record is shorter than it says");
        const at = this.offset;
        this.offset += length;
        return at;
    }

    u8(): number {
        return this.view.getUint8(this.take(1));
    }

    u16(): number {
        return this.view.getUint16(this.take(2), false);
    }

    u32(): number {
        return this.view.getUint32(this.take(4), false);
    }

    slice(length: number): Uint8Array {
        const at = this.take(length);
        return this.bytes.subarray(at, at + length);
    }

    text(length: number): string {
        return Buffer.from(this.slice(length)).toString("utf8");
    }

    /** A `DNS_COUNT_NAME`, as the name reads: `dc1.sadm.test`. */
    name(): string {
        this.u8();
        const labels = this.u8();
        const parts: string[] = [];
        for (let i = 0; i < labels; i++) parts.push(this.text(this.u8()));
        // The zero that ends the name. A name without labels -- the root -- has none.
        if (labels > 0) this.u8();
        return parts.join(".");
    }
}

/** An IPv6 address the way RFC 5952 writes it: lower case, the longest run of zeros as `::`. */
export function formatIpv6(bytes: Uint8Array): string {
    const groups: number[] = [];
    for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);

    let bestStart = -1;
    let bestLength = 0;
    for (let i = 0; i < 8; i++) {
        if (groups[i] !== 0) continue;
        let end = i;
        while (end < 8 && groups[end] === 0) end++;
        if (end - i > bestLength) {
            bestStart = i;
            bestLength = end - i;
        }
        i = end;
    }
    const hex = (list: number[]) => list.map((group) => group.toString(16)).join(":");
    // A single zero group is written out; only a run of two or more is shortened.
    if (bestLength < 2) return hex(groups);
    return `${hex(groups.slice(0, bestStart))}::${hex(groups.slice(bestStart + bestLength))}`;
}

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

function decodeData(type: number, bytes: Uint8Array): DnsRecordData | DnsTombstone {
    const reader = new Reader(bytes);
    switch (type) {
        case 0:
            return { type: "tombstone" };
        case DNS_TYPE_CODES.A:
            if (bytes.length !== 4) break;
            return { type: "A", address: [...bytes].join(".") };
        case DNS_TYPE_CODES.AAAA:
            if (bytes.length !== 16) break;
            return { type: "AAAA", address: formatIpv6(bytes) };
        case DNS_TYPE_CODES.CNAME:
            return { type: "CNAME", target: reader.name() };
        case DNS_TYPE_CODES.PTR:
            return { type: "PTR", target: reader.name() };
        case DNS_TYPE_CODES.NS:
            return { type: "NS", target: reader.name() };
        case DNS_TYPE_CODES.TXT: {
            const strings: string[] = [];
            while (!reader.done) strings.push(reader.text(reader.u8()));
            return { type: "TXT", strings };
        }
        case DNS_TYPE_CODES.MX:
            return { type: "MX", preference: reader.u16(), exchange: reader.name() };
        case DNS_TYPE_CODES.SRV:
            return { type: "SRV", priority: reader.u16(), weight: reader.u16(), port: reader.u16(), target: reader.name() };
        case DNS_TYPE_CODES.SOA:
            return {
                type: "SOA",
                serial: reader.u32(),
                refresh: reader.u32(),
                retry: reader.u32(),
                expire: reader.u32(),
                minimum: reader.u32(),
                primary: reader.name(),
                mailbox: reader.name(),
            };
    }
    return { type: "other", typeCode: type, hex: toHex(bytes) };
}

/**
 * Reads one value. Null for what is not a record in the layout this knows: too short, a
 * length that does not fit, another version.
 *
 * A record of a type whose data does not read as that type should is kept as `other` with
 * its bytes: it is there, and a list that left it out would say the name has no such record.
 */
export function decodeDnsRecord(bytes: Uint8Array): DecodedDnsRecord | null {
    if (bytes.length < HEAD_LENGTH) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0, true) !== bytes.length - HEAD_LENGTH) return null;
    if (view.getUint8(4) !== 5) return null;

    const type = view.getUint16(2, true);
    const payload = bytes.subarray(HEAD_LENGTH);
    let data: DnsRecordData | DnsTombstone;
    try {
        data = decodeData(type, payload);
    } catch {
        data = { type: "other", typeCode: type, hex: toHex(payload) };
    }
    return {
        head: {
            rank: view.getUint8(5),
            flags: view.getUint16(6, true),
            serial: view.getUint32(8, true),
            ttl: view.getUint32(12, false),
            reserved: view.getUint32(16, true),
            timestamp: view.getUint32(20, true),
        },
        data,
    };
}
