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

// ── Writing ──────────────────────────────────────────────────────────────────

/** The rank of a record that belongs to the zone itself: what every record entered here is. */
export const DNS_RANK_ZONE = 0xf0;

/** The head of a record somebody entered: of the zone, written at `serial`, and not ageing. */
export const staticHead = (serial: number, ttl: number): DnsRecordHead => ({
    rank: DNS_RANK_ZONE,
    flags: 0,
    serial,
    ttl,
    reserved: 0,
    timestamp: 0,
});

/** An IPv4 address as its four bytes. */
function ipv4Bytes(address: string): number[] {
    const parts = address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        throw new RangeError(`${address} is no IPv4 address`);
    }
    return parts;
}

/** An IPv6 address as its sixteen bytes, however it is shortened, with an IPv4 tail where it has one. */
export function ipv6Bytes(address: string): number[] {
    const halves = address.toLowerCase().split("::");
    if (halves.length > 2) throw new RangeError(`${address} is no IPv6 address`);
    const groupsOf = (half: string): number[] => {
        if (half === "") return [];
        return half.split(":").flatMap((group, index, all) => {
            if (group.includes(".")) {
                if (index !== all.length - 1) throw new RangeError(`${address} is no IPv6 address`);
                const [a, b, c, d] = ipv4Bytes(group);
                return [(a << 8) | b, (c << 8) | d];
            }
            if (!/^[0-9a-f]{1,4}$/.test(group)) throw new RangeError(`${address} is no IPv6 address`);
            return [parseInt(group, 16)];
        });
    };
    const head = groupsOf(halves[0]);
    const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
    const gap = 8 - head.length - tail.length;
    if (halves.length === 2 ? gap < 1 : gap !== 0) throw new RangeError(`${address} is no IPv6 address`);
    return [...head, ...new Array<number>(Math.max(gap, 0)).fill(0), ...tail].flatMap((group) => [group >> 8, group & 0xff]);
}

/** A host name as a `DNS_COUNT_NAME`: its length, the number of its labels, each behind its length, a zero. */
function countName(name: string): number[] {
    const labels = name
        .replace(/\.$/, "")
        .split(".")
        .filter((label) => label !== "")
        .map((label) => [...Buffer.from(label, "utf8")]);
    if (labels.some((label) => label.length > 63)) throw new RangeError(`A label of ${name} is longer than 63 bytes`);
    const body = labels.flatMap((label) => [label.length, ...label]);
    // A name without labels -- the root -- has no zero to end it, as Samba writes it.
    const bytes = labels.length > 0 ? [...body, 0] : [];
    if (bytes.length > 255) throw new RangeError(`${name} is longer than a name may be`);
    return [bytes.length, labels.length, ...bytes];
}

const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];
const u32 = (value: number): number[] => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

function encodeData(data: DnsRecordData): { type: number; bytes: number[] } {
    switch (data.type) {
        case "A":
            return { type: DNS_TYPE_CODES.A, bytes: ipv4Bytes(data.address) };
        case "AAAA":
            return { type: DNS_TYPE_CODES.AAAA, bytes: ipv6Bytes(data.address) };
        case "CNAME":
            return { type: DNS_TYPE_CODES.CNAME, bytes: countName(data.target) };
        case "PTR":
            return { type: DNS_TYPE_CODES.PTR, bytes: countName(data.target) };
        case "NS":
            return { type: DNS_TYPE_CODES.NS, bytes: countName(data.target) };
        case "TXT":
            return {
                type: DNS_TYPE_CODES.TXT,
                bytes: data.strings.flatMap((text) => {
                    const encoded = [...Buffer.from(text, "utf8")];
                    if (encoded.length > 255) throw new RangeError("A text of a TXT record is longer than 255 bytes");
                    return [encoded.length, ...encoded];
                }),
            };
        case "MX":
            return { type: DNS_TYPE_CODES.MX, bytes: [...u16(data.preference), ...countName(data.exchange)] };
        case "SRV":
            return {
                type: DNS_TYPE_CODES.SRV,
                bytes: [...u16(data.priority), ...u16(data.weight), ...u16(data.port), ...countName(data.target)],
            };
        case "SOA":
            return {
                type: DNS_TYPE_CODES.SOA,
                bytes: [
                    ...u32(data.serial),
                    ...u32(data.refresh),
                    ...u32(data.retry),
                    ...u32(data.expire),
                    ...u32(data.minimum),
                    ...countName(data.primary),
                    ...countName(data.mailbox),
                ],
            };
        case "other":
            return { type: data.typeCode, bytes: [...Buffer.from(data.hex, "hex")] };
    }
}

/**
 * Writes one value of `dnsRecord`: the reverse of `decodeDnsRecord`, byte for byte -- what
 * was read and is written back unchanged is the value that was there, which is what lets a
 * change name the value it replaces. Throws a `RangeError` for what does not fit a record.
 */
export function encodeDnsRecord(head: DnsRecordHead, data: DnsRecordData): Uint8Array {
    const { type, bytes } = encodeData(data);
    const record = new Uint8Array(HEAD_LENGTH + bytes.length);
    const view = new DataView(record.buffer);
    view.setUint16(0, bytes.length, true);
    view.setUint16(2, type, true);
    view.setUint8(4, 5);
    view.setUint8(5, head.rank);
    view.setUint16(6, head.flags, true);
    view.setUint32(8, head.serial, true);
    view.setUint32(12, head.ttl, false);
    view.setUint32(16, head.reserved, true);
    view.setUint32(20, head.timestamp, true);
    record.set(bytes, HEAD_LENGTH);
    return record;
}
