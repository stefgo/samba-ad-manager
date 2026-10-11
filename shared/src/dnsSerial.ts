/**
 * The serial number of a zone: 32 bits that only ever count up, and wrap around.
 *
 * A secondary name server asks for a zone again when the serial number it is offered is
 * higher than the one it has -- "higher" as RFC 1982 defines it, on a circle rather than a
 * line: a number is higher than another when it is less than half the circle ahead of it.
 */

const MODULO = 2 ** 32;
const HALF = 2 ** 31;

/**
 * Negative when `a` is behind `b`, positive when it is ahead, 0 when they are the same.
 * Two numbers exactly half the circle apart have no order; they read as "ahead", which is
 * the case that needs a person to look.
 */
export function compareSerial(a: number, b: number): number {
    if (a === b) return 0;
    const ahead = (((a - b) % MODULO) + MODULO) % MODULO;
    return ahead <= HALF ? 1 : -1;
}

/** The highest of some serial numbers; null for none. */
export function highestSerial(serials: readonly number[]): number | null {
    let highest: number | null = null;
    for (const serial of serials) {
        if (highest === null || compareSerial(serial, highest) > 0) highest = serial;
    }
    return highest;
}

/** The serial number after `serial`. Never 0, which some servers read as "no serial number yet". */
export function nextSerial(serial: number): number {
    const next = (serial + 1) % MODULO;
    return next === 0 ? 1 : next;
}
