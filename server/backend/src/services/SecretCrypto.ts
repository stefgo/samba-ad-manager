import crypto from "crypto";
import { appConfig, secretKeyPersisted } from "../config/AppConfig.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_INFO = "sadm-stored-secret";

/**
 * Derives the encryption key from `secretKey` in config.yaml. Deliberately NOT derived
 * from jwtSecret: rotating the key that signs sessions must not make stored secrets
 * unreadable.
 *
 * Protects the secrets the server has to read back -- today the auth tokens it presents
 * to outbound clients. A token the server only has to recognise is hashed instead.
 */
function derivedKey(): Buffer {
    const secret = appConfig.secretKey;
    if (!secret) {
        throw new Error("secretKey is not configured — cannot handle stored secrets");
    }
    return Buffer.from(crypto.hkdfSync("sha256", secret, "sadm", KEY_INFO, 32));
}

/**
 * Returns iv:tag:ciphertext, all hex encoded.
 *
 * Refuses while secretKey exists only in memory: a value encrypted with it would be lost
 * on the next restart, and that loss would not show until then.
 */
export function encryptSecret(plain: string): string {
    if (!secretKeyPersisted()) {
        throw new Error(
            "secretKey was generated but could not be written to config.yaml — refusing to encrypt with a key that is lost on restart. Make config.yaml writable and restart the server.",
        );
    }
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, derivedKey(), iv);
    const encrypted = Buffer.concat([
        cipher.update(plain, "utf8"),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
    const parts = stored.split(":");
    if (parts.length !== 3) {
        throw new Error("Cannot decrypt a stored secret (malformed)");
    }
    const [ivHex, tagHex, dataHex] = parts;
    try {
        const decipher = crypto.createDecipheriv(
            ALGORITHM,
            derivedKey(),
            Buffer.from(ivHex, "hex"),
        );
        decipher.setAuthTag(Buffer.from(tagHex, "hex"));
        return Buffer.concat([
            decipher.update(Buffer.from(dataHex, "hex")),
            decipher.final(),
        ]).toString("utf8");
    } catch {
        throw new Error(
            "Cannot decrypt a stored secret — was secretKey changed? Store it again",
        );
    }
}
