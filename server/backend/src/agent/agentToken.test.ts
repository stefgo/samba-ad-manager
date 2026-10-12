import { describe, expect, it } from "vitest";
import { deriveOutboundToken, hashToken, newToken, reconnectDelay, sameHash } from "./agentToken.js";

const DC = "11111111-1111-4111-8111-111111111111";

describe("deriveOutboundToken", () => {
    it("is the same token every time it is derived", () => {
        expect(deriveOutboundToken("secret", DC, "nonce")).toBe(deriveOutboundToken("secret", DC, "nonce"));
    });

    it("does not depend on how the id is spelled", () => {
        expect(deriveOutboundToken("secret", DC.toUpperCase(), "nonce")).toBe(deriveOutboundToken("secret", DC, "nonce"));
    });

    it("is another token for another secret, domain controller or nonce", () => {
        const token = deriveOutboundToken("secret", DC, "nonce");
        expect(deriveOutboundToken("other", DC, "nonce")).not.toBe(token);
        expect(deriveOutboundToken("secret", "22222222-2222-4222-8222-222222222222", "nonce")).not.toBe(token);
        expect(deriveOutboundToken("secret", DC, "nonce2")).not.toBe(token);
    });
});

describe("hashToken and sameHash", () => {
    it("tell a token from another one by its hash", () => {
        const token = newToken();
        expect(sameHash(hashToken(token), hashToken(token))).toBe(true);
        expect(sameHash(hashToken(token), hashToken(newToken()))).toBe(false);
        expect(sameHash(hashToken(token), "short")).toBe(false);
    });
});

describe("reconnectDelay", () => {
    it("climbs to a minute and stays there", () => {
        expect([0, 1, 2, 3, 4, 50].map(reconnectDelay)).toEqual([5000, 10000, 30000, 60000, 60000, 60000]);
    });
});
