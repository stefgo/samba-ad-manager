import { beforeEach, describe, expect, it, vi } from "vitest";

// AppConfig reads config.yaml when it is imported and writes generated secrets back to it;
// the test stands in for it with a key it can change.
const config = vi.hoisted(() => ({ secretKey: "first-key" as string | undefined, persisted: true }));
vi.mock("../config/AppConfig.js", () => ({
    appConfig: {
        get secretKey() {
            return config.secretKey;
        },
    },
    secretKeyPersisted: () => config.persisted,
}));

import { decryptSecret, encryptSecret } from "./SecretCrypto.js";

beforeEach(() => {
    config.secretKey = "first-key";
    config.persisted = true;
});

describe("SecretCrypto", () => {
    it("reads back what it stored", () => {
        expect(decryptSecret(encryptSecret("agent-token"))).toBe("agent-token");
        expect(decryptSecret(encryptSecret(""))).toBe("");
        expect(decryptSecret(encryptSecret("schlüssel 🔑"))).toBe("schlüssel 🔑");
    });

    it("stores iv, tag and ciphertext as hex, without the plain text", () => {
        const stored = encryptSecret("agent-token");

        expect(stored).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
        expect(stored).not.toContain("agent-token");
    });

    it("encrypts the same value differently each time", () => {
        expect(encryptSecret("agent-token")).not.toBe(encryptSecret("agent-token"));
    });

    it("cannot read a secret after secretKey changed", () => {
        const stored = encryptSecret("agent-token");
        config.secretKey = "second-key";

        expect(() => decryptSecret(stored)).toThrow(/was secretKey changed/);
    });

    it("rejects a stored value that was tampered with", () => {
        const [iv, tag, data] = encryptSecret("agent-token").split(":");
        const flipped = (data[0] === "0" ? "1" : "0") + data.slice(1);

        expect(() => decryptSecret(`${iv}:${tag}:${flipped}`)).toThrow(/Cannot decrypt/);
    });

    it("rejects a value that is not iv:tag:ciphertext", () => {
        expect(() => decryptSecret("not-a-stored-secret")).toThrow(/malformed/);
    });

    it("refuses to work without a secretKey", () => {
        config.secretKey = undefined;

        expect(() => encryptSecret("agent-token")).toThrow(/secretKey is not configured/);
    });

    it("refuses to encrypt with a key that exists only in memory", () => {
        config.persisted = false;

        expect(() => encryptSecret("agent-token")).toThrow(/lost on restart/);
    });
});
