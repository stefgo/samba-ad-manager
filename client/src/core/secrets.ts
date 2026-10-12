import crypto from "crypto";

/**
 * Whether two secrets are the same, in a time that does not depend on how much of the
 * input was right.
 *
 * Both sides are hashed first, so `timingSafeEqual` always sees two buffers of one length:
 * it throws on a length mismatch, and comparing the lengths beforehand would leak how long
 * the real secret is. That is the difference to `verifySetupPin`, which may compare lengths
 * because a PIN's length is fixed and printed in the log anyway -- the auth token and the
 * registration secret are neither.
 *
 * A missing value on either side is never equal, including two missing ones. An agent with
 * no token configured must not be opened by a caller that presents none.
 */
export function secretEquals(
    actual: string | undefined | null,
    expected: string | undefined | null,
): boolean {
    if (!actual || !expected) return false;
    const digest = (value: string) =>
        crypto.createHash("sha256").update(value, "utf8").digest();
    return crypto.timingSafeEqual(digest(actual), digest(expected));
}
