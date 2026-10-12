/**
 * Network arithmetic for `allowedNetworks`: whether the server may dial this agent from the
 * address it comes from. IPv4 only, and says so.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Strips the IPv4-mapped IPv6 prefix. A dual-stack listener reports `::ffff:10.0.0.5` for
 * what is an IPv4 peer; read as it is, that address would have been converted to 0 and
 * matched against networks as 0.0.0.0 -- a wrong decision rather than a failed one.
 */
export function normaliseIp(ip: string): string {
    return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/** The four octets, or null for anything that is not dotted IPv4. */
function ipv4ToBytes(ip: string): number[] | null {
    const match = IPV4.exec(ip);
    if (!match) return null;
    const octets = match.slice(1).map(Number);
    return octets.some((octet) => octet > 255) ? null : octets;
}

/** The address as a 32-bit integer, or null for anything that is not dotted IPv4. */
function ipToLong(ip: string): number | null {
    const octets = ipv4ToBytes(ip);
    if (!octets) return null;
    return (
        ((octets[0] << 24) >>> 0) +
        ((octets[1] << 16) >>> 0) +
        ((octets[2] << 8) >>> 0) +
        octets[3]
    );
}

/**
 * Whether an address lies within a network. A value without a prefix length is a /32.
 *
 * An address that is not IPv4 -- a real IPv6 peer -- matches only /0. It used to be
 * converted to 0 and so matched every network that contains 0.0.0.0.
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
    const [range, bitsStr] = cidr.split("/");
    const bits = bitsStr === undefined ? 32 : Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    if (bits === 0) return true;

    const ipLong = ipToLong(normaliseIp(ip));
    const rangeLong = ipToLong(range);
    if (ipLong === null || rangeLong === null) return false;

    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return ((ipLong & mask) >>> 0) === ((rangeLong & mask) >>> 0);
}

/**
 * Whether an address is in any of the networks. An empty list means no restriction was
 * configured, and `defaultAllow` says what that means to the caller.
 */
export function isIpInNetworks(
    ip: string,
    networks: string[],
    defaultAllow = false,
): boolean {
    if (!networks || networks.length === 0) return defaultAllow;
    return networks.some((cidr) => isIpInCidr(ip, cidr));
}
