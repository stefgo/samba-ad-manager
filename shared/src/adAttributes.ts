/**
 * How Active Directory encodes what it stores, turned into what a reader expects: flags
 * into booleans, a file time into a date, a binary GUID or SID into its text form. Pure, so
 * every rule is tested without a directory -- the agent applies them to what LDAP returns,
 * and writes with the same constants.
 */

/** The bits of `userAccountControl` this application reads or sets. */
export const UAC = {
    ACCOUNT_DISABLE: 0x0002,
    LOCKOUT: 0x0010,
    PASSWORD_NOT_REQUIRED: 0x0020,
    NORMAL_ACCOUNT: 0x0200,
    WORKSTATION_TRUST_ACCOUNT: 0x1000,
    SERVER_TRUST_ACCOUNT: 0x2000,
    DONT_EXPIRE_PASSWORD: 0x10000,
    SMARTCARD_REQUIRED: 0x40000,
    PASSWORD_EXPIRED: 0x800000,
} as const;

/** `userAccountControl` as LDAP returns it -- a decimal string -- or 0 for anything else. */
export function parseUac(value: string | number | null | undefined): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

export const hasUacFlag = (uac: number, flag: number): boolean => (uac & flag) !== 0;

/** `uac` with a flag set or cleared, every other bit as it was. */
export const withUacFlag = (uac: number, flag: number, on: boolean): number => (on ? uac | flag : uac & ~flag) >>> 0;

/** Seconds between 1601-01-01, where a Windows file time starts, and 1970-01-01. */
const EPOCH_OFFSET_SECONDS = 11644473600n;

/** The value `accountExpires` holds for "never", next to 0, which means the same. */
const NEVER = 0x7fffffffffffffffn;

/**
 * A Windows file time -- 100 ns intervals since 1601, the form of `pwdLastSet`,
 * `lastLogonTimestamp`, `lockoutTime` and `accountExpires` -- as ISO 8601. `null` for 0 and
 * for "never", which is what both mean, and for anything that is no number.
 */
export function fileTimeToIso(value: string | null | undefined): string | null {
    if (!value || !/^-?\d+$/.test(value)) return null;
    const ticks = BigInt(value);
    if (ticks <= 0n || ticks >= NEVER) return null;
    const millis = ticks / 10000n - EPOCH_OFFSET_SECONDS * 1000n;
    const date = new Date(Number(millis));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** An ISO date as a Windows file time, for writing `accountExpires`. `null` writes "never". */
export function isoToFileTime(iso: string | null): string {
    if (iso === null) return "0";
    const millis = Date.parse(iso);
    if (Number.isNaN(millis)) throw new Error(`Not a date: ${iso}`);
    return String((BigInt(millis) + EPOCH_OFFSET_SECONDS * 1000n) * 10000n);
}

/**
 * A generalized time -- `20261010201709.0Z`, the form of `whenCreated` and `whenChanged` --
 * as ISO 8601, or null.
 */
export function generalizedTimeToIso(value: string | null | undefined): string | null {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d+))?Z$/.exec(value ?? "");
    if (!match) return null;
    const [, year, month, day, hour, minute, second, fraction] = match;
    const millis = fraction ? fraction.padEnd(3, "0").slice(0, 3) : "000";
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}Z`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const hex = (bytes: Uint8Array, indices: number[]): string =>
    indices.map((index) => bytes[index].toString(16).padStart(2, "0")).join("");

/**
 * The sixteen bytes of an `objectGUID` in the form everybody writes a GUID in. The first
 * three groups are stored little-endian, which is why this is not a plain hex dump.
 */
export function guidFromBytes(bytes: Uint8Array): string | null {
    if (bytes.length !== 16) return null;
    return [
        hex(bytes, [3, 2, 1, 0]),
        hex(bytes, [5, 4]),
        hex(bytes, [7, 6]),
        hex(bytes, [8, 9]),
        hex(bytes, [10, 11, 12, 13, 14, 15]),
    ].join("-");
}

export const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The DN form that addresses an object by its GUID, wherever it has been moved to. */
export function guidDn(guid: string): string {
    if (!GUID_PATTERN.test(guid)) throw new Error(`Not a GUID: ${guid}`);
    return `<GUID=${guid.toLowerCase()}>`;
}

/** The bytes of an `objectSid` as `S-1-5-21-…`, or null for what is no SID. */
export function sidFromBytes(bytes: Uint8Array): string | null {
    if (bytes.length < 8) return null;
    const revision = bytes[0];
    const count = bytes[1];
    if (bytes.length !== 8 + count * 4) return null;
    let authority = 0n;
    for (let i = 2; i < 8; i++) authority = (authority << 8n) | BigInt(bytes[i]);
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
        const offset = 8 + i * 4;
        const value =
            (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
        parts.push(String(value));
    }
    return `S-${revision}-${authority}${parts.length > 0 ? `-${parts.join("-")}` : ""}`;
}

/** The last part of a SID: what `primaryGroupID` refers to a group by. */
export function ridOfSid(sid: string | null | undefined): number | null {
    const match = /-(\d+)$/.exec(sid ?? "");
    return match ? Number(match[1]) : null;
}

export const GROUP_SCOPES = ["global", "domainLocal", "universal"] as const;
export type GroupScope = (typeof GROUP_SCOPES)[number];
export const GROUP_KINDS = ["security", "distribution"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

const GROUP_TYPE = {
    BUILTIN: 0x1,
    GLOBAL: 0x2,
    DOMAIN_LOCAL: 0x4,
    UNIVERSAL: 0x8,
    SECURITY: 0x80000000,
} as const;

/** What a `groupType` -- a signed 32-bit number as text -- says about a group. */
export function parseGroupType(value: string | number | null | undefined): {
    scope: GroupScope;
    kind: GroupKind;
    builtin: boolean;
} {
    const parsed = (typeof value === "number" ? value : Number.parseInt(value ?? "", 10)) >>> 0;
    const type = Number.isFinite(parsed) ? parsed : 0;
    return {
        scope: type & GROUP_TYPE.UNIVERSAL ? "universal" : type & GROUP_TYPE.DOMAIN_LOCAL ? "domainLocal" : "global",
        kind: (type & GROUP_TYPE.SECURITY) >>> 0 ? "security" : "distribution",
        builtin: (type & GROUP_TYPE.BUILTIN) !== 0,
    };
}

/** The `groupType` to write for a new group, as the signed number LDAP expects. */
export function formatGroupType(scope: GroupScope, kind: GroupKind): string {
    const scopeBit =
        scope === "universal" ? GROUP_TYPE.UNIVERSAL : scope === "domainLocal" ? GROUP_TYPE.DOMAIN_LOCAL : GROUP_TYPE.GLOBAL;
    return String((scopeBit | (kind === "security" ? GROUP_TYPE.SECURITY : 0)) | 0);
}

/**
 * A password as `unicodePwd` takes it: the text in double quotes, UTF-16LE. As bytes, since
 * that is what goes on the wire.
 */
export function encodeUnicodePwd(password: string): Uint8Array {
    const quoted = `"${password}"`;
    const bytes = new Uint8Array(quoted.length * 2);
    for (let i = 0; i < quoted.length; i++) {
        const unit = quoted.charCodeAt(i);
        bytes[i * 2] = unit & 0xff;
        bytes[i * 2 + 1] = unit >> 8;
    }
    return bytes;
}

/** A value as it has to stand in an LDAP search filter (RFC 4515). */
export function escapeFilterValue(value: string): string {
    return value.replace(/[\\*()\0]/g, (char) => `\\${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
}
