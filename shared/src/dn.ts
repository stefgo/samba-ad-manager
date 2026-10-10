/**
 * Distinguished names, as the directory writes them (RFC 4514). In shared because the agent
 * builds them, the server checks them, and the dashboard shows their parts -- and a DN split
 * at every comma is wrong for the first object somebody names "Doe, Jane".
 */

export interface Rdn {
    /** The attribute type as written: `CN`, `OU`, `DC`. */
    type: string;
    /** The value with its escapes resolved. */
    value: string;
}

/**
 * The relative names of a DN, first (most specific) first; `null` for anything that is not
 * one. The empty string is the root and has none.
 */
export function parseDn(dn: string): Rdn[] | null {
    if (dn === "") return [];
    const rdns: Rdn[] = [];
    let type = "";
    let value = "";
    let inValue = false;
    // Trailing spaces are dropped from a value unless they were escaped.
    let keep = 0;

    const close = (): boolean => {
        const name = type.trim();
        if (!inValue || name === "" || !/^[A-Za-z][A-Za-z0-9-]*$|^\d+(\.\d+)*$/.test(name)) return false;
        rdns.push({ type: name, value: value.slice(0, Math.max(keep, value.trimEnd().length)) });
        type = "";
        value = "";
        inValue = false;
        keep = 0;
        return true;
    };

    for (let i = 0; i < dn.length; i++) {
        const char = dn[i];
        if (!inValue) {
            if (char === "=") {
                inValue = true;
                // Leading spaces of a value do not belong to it.
                while (dn[i + 1] === " ") i++;
            } else if (char === ",") {
                return null;
            } else {
                type += char;
            }
            continue;
        }
        if (char === "\\") {
            const hex = dn.slice(i + 1, i + 3);
            if (/^[0-9a-fA-F]{2}$/.test(hex)) {
                // One or more escaped bytes make up one UTF-8 character.
                const bytes: number[] = [];
                while (dn[i] === "\\" && /^[0-9a-fA-F]{2}$/.test(dn.slice(i + 1, i + 3))) {
                    bytes.push(parseInt(dn.slice(i + 1, i + 3), 16));
                    i += 3;
                }
                i--;
                value += new TextDecoder().decode(new Uint8Array(bytes));
            } else if (i + 1 < dn.length) {
                value += dn[++i];
            } else {
                return null;
            }
            keep = value.length;
            continue;
        }
        // A multi-valued RDN (`CN=a+SN=b`) does not occur in Active Directory and is not read.
        if (char === "+") return null;
        if (char === ",") {
            if (!close()) return null;
            continue;
        }
        value += char;
    }
    return close() ? rdns : null;
}

/** A value as it has to stand in a DN: the characters RFC 4514 reserves, escaped. */
export function escapeRdnValue(value: string): string {
    let escaped = value.replace(/[\\,+"<>;=]/g, (char) => `\\${char}`).replace(/\0/g, "\\00");
    if (/^[ #]/.test(escaped)) escaped = `\\${escaped}`;
    if (/ $/.test(escaped) && !/\\ $/.test(escaped)) escaped = `${escaped.slice(0, -1)}\\ `;
    return escaped;
}

/** A DN from its relative names, first first. */
export const formatDn = (rdns: readonly Rdn[]): string =>
    rdns.map((rdn) => `${rdn.type}=${escapeRdnValue(rdn.value)}`).join(",");

/** The DN one level up, or `null` for the root and for what is no DN. */
export function parentDn(dn: string): string | null {
    const rdns = parseDn(dn);
    return rdns && rdns.length > 0 ? formatDn(rdns.slice(1)) : null;
}

/** The value of the first relative name: what an object is called within its container. */
export function rdnValue(dn: string): string | null {
    return parseDn(dn)?.[0]?.value ?? null;
}

/** Whether `dn` lies below `base` or is `base` itself. Types and values compare without case. */
export function isDnWithin(dn: string, base: string): boolean {
    const inner = parseDn(dn);
    const outer = parseDn(base);
    if (!inner || !outer || outer.length > inner.length) return false;
    const offset = inner.length - outer.length;
    return outer.every(
        (rdn, i) =>
            rdn.type.toLowerCase() === inner[offset + i].type.toLowerCase() &&
            rdn.value.toLowerCase() === inner[offset + i].value.toLowerCase(),
    );
}

/** `DC=sadm,DC=test` → `sadm.test`; `null` for a DN that is not made of DC parts only. */
export function dnsNameOfDn(dn: string): string | null {
    const rdns = parseDn(dn);
    if (!rdns || rdns.length === 0 || rdns.some((rdn) => rdn.type.toUpperCase() !== "DC")) return null;
    return rdns.map((rdn) => rdn.value).join(".").toLowerCase();
}

/**
 * Who a `CN=NTDS Settings,CN=<server>,CN=Servers,CN=<site>,CN=Sites,…` names: the domain
 * controller and its site. That DN is how the directory refers to a DC -- as the owner of a
 * FSMO role and as a replication partner. Also takes the server object's own DN.
 */
export function parseServerDn(dn: string): { name: string; site: string | null } | null {
    const rdns = parseDn(dn);
    if (!rdns) return null;
    const start = rdns[0]?.value === "NTDS Settings" ? 1 : 0;
    const server = rdns[start];
    if (!server || rdns[start + 1]?.value !== "Servers") return null;
    return { name: server.value, site: rdns[start + 2]?.value ?? null };
}
