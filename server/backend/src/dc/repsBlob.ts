import { guidFromBytes } from "@sadm/shared";

/**
 * One value of `repsFrom` or `repsTo`: the state of one replication link, as the domain
 * controller keeps it on the head of a naming context.
 *
 * The value is the NDR encoding of `repsFromToBlob` (Samba's `drsblobs.idl`, which follows
 * MS-DRSR): a fixed layout, little-endian, so it is read by offset rather than with an NDR
 * library. Versions 1 and 2 share everything read here; they differ only in how the
 * partner's DNS name is appended, which this does not need -- the partner is named by the
 * GUID of its NTDS settings.
 *
 *     0  uint32  version
 *     4  uint32  reserved
 *     8  uint32  blobsize
 *    12  uint32  consecutive_sync_failures
 *    16  hyper   last_success      seconds since 1601-01-01, 0 for never
 *    24  hyper   last_attempt
 *    32  uint32  result_last_attempt (WERROR)
 *    36  uint32  other_info (offset)
 *    40  uint32  other_info_length
 *    44  uint32  replica_flags
 *    48  uint8   schedule[84]
 *   132  uint32  reserved
 *   136  hyper   highwatermark x 3
 *   160  GUID    source_dsa_obj_guid
 *   176  GUID    source_dsa_invocation_id
 *   192  GUID    transport_guid
 */
export interface ReplicationLink {
    /** The `objectGUID` of the partner's NTDS settings. */
    partnerId: string;
    /** ISO time; null for never. */
    lastSuccess: string | null;
    lastAttempt: string | null;
    consecutiveFailures: number;
    /** The Windows error code of the last attempt; 0 is success. */
    resultCode: number;
}

const FIXED_LENGTH = 208;

/** Seconds between 1601-01-01 and 1970-01-01. */
const EPOCH_OFFSET_SECONDS = 11_644_473_600n;

/** A time as the blob holds it -- whole seconds since 1601 -- as ISO 8601; null for 0, which is "never". */
function isoOfSeconds(value: bigint): string | null {
    if (value <= 0n) return null;
    const ms = Number((value - EPOCH_OFFSET_SECONDS) * 1000n);
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Reads one value. Null for what is not a link in a layout this knows: too short, or another version. */
export function decodeRepsBlob(bytes: Uint8Array): ReplicationLink | null {
    if (bytes.length < FIXED_LENGTH) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint32(0, true);
    if (version !== 1 && version !== 2) return null;
    const partnerId = guidFromBytes(bytes.subarray(160, 176));
    if (!partnerId) return null;
    return {
        partnerId,
        consecutiveFailures: view.getUint32(12, true),
        lastSuccess: isoOfSeconds(view.getBigUint64(16, true)),
        lastAttempt: isoOfSeconds(view.getBigUint64(24, true)),
        resultCode: view.getUint32(32, true),
    };
}
