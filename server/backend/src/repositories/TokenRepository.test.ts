import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/AppConfig.js", () => ({
    appConfig: { secretKey: "test-secret-key" },
    secretKeyPersisted: () => true,
}));
vi.mock("../core/Database.js", async () => {
    const { migratedMemoryDatabase } = await import("../testing/memoryDatabase.js");
    return { default: await migratedMemoryDatabase() };
});

import db from "../core/Database.js";
import { hashToken, TokenRepository } from "./TokenRepository.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString();

beforeEach(() => {
    db.exec("DELETE FROM registration_tokens");
});

describe("hashToken", () => {
    it("is the SHA-256 of the token, in hex", () => {
        // The well-known digest of "abc".
        expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    });
});

describe("TokenRepository", () => {
    it("stores the hash and never the token itself", () => {
        TokenRepository.create("plain-token", fromNow(HOUR_MS));

        const [row] = TokenRepository.findAll();
        expect(row.token_hash).toBe(hashToken("plain-token"));
        expect(JSON.stringify(db.prepare("SELECT * FROM registration_tokens").all())).not.toContain("plain-token");
    });

    it("finds a token that is neither used nor expired", () => {
        TokenRepository.create("valid", fromNow(HOUR_MS));

        expect(TokenRepository.findValidByToken("valid")?.token_hash).toBe(hashToken("valid"));
        expect(TokenRepository.findValidByToken("other")).toBeUndefined();
    });

    it("does not find a token by its hash", () => {
        TokenRepository.create("valid", fromNow(HOUR_MS));

        expect(TokenRepository.findValidByToken(hashToken("valid"))).toBeUndefined();
    });

    it("does not find an expired token", () => {
        TokenRepository.create("expired", fromNow(-HOUR_MS));

        expect(TokenRepository.findValidByToken("expired")).toBeUndefined();
    });

    it("redeems a token once", () => {
        TokenRepository.create("once", fromNow(HOUR_MS));

        expect(TokenRepository.markUsed(hashToken("once")).changes).toBe(1);
        expect(TokenRepository.findValidByToken("once")).toBeUndefined();
        expect(TokenRepository.findAll()[0].used_at).not.toBeNull();
    });

    it("deletes by hash and says whether a row went", () => {
        TokenRepository.create("gone", fromNow(HOUR_MS));

        expect(TokenRepository.delete(hashToken("gone")).changes).toBe(1);
        expect(TokenRepository.delete(hashToken("gone")).changes).toBe(0);
        expect(TokenRepository.findAll()).toEqual([]);
    });

    describe("cleanupInvalidTokens", () => {
        it("removes what has been invalid for longer than the TTL and keeps the rest", () => {
            TokenRepository.create("valid", fromNow(HOUR_MS));
            TokenRepository.create("expired-recently", fromNow(-HOUR_MS));
            TokenRepository.create("expired-long-ago", fromNow(-10 * DAY_MS));

            expect(TokenRepository.cleanupInvalidTokens(7)).toBe(1);
            expect(TokenRepository.findAll().map((row) => row.token_hash).sort()).toEqual(
                [hashToken("valid"), hashToken("expired-recently")].sort(),
            );
        });

        it("counts a used token from the moment it was used, not from its expiry", () => {
            TokenRepository.create("used", fromNow(HOUR_MS));
            TokenRepository.markUsed(hashToken("used"));
            db.prepare("UPDATE registration_tokens SET used_at = datetime('now', '-10 days')").run();

            expect(TokenRepository.cleanupInvalidTokens(7)).toBe(1);
        });

        it("never removes a token that is still valid, whatever the TTL", () => {
            TokenRepository.create("valid", fromNow(HOUR_MS));

            expect(TokenRepository.cleanupInvalidTokens(0)).toBe(0);
            expect(TokenRepository.cleanupInvalidTokens(Number.NaN)).toBe(0);
        });
    });
});
