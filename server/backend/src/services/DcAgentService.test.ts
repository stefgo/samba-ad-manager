import { beforeEach, describe, expect, it, vi } from "vitest";

// Both modules read the files of an installation the moment they are imported.
vi.mock("../core/Database.js", async () => {
    const { migratedMemoryDatabase } = await import("../testing/memoryDatabase.js");
    return { default: await migratedMemoryDatabase() };
});
vi.mock("../config/AppConfig.js", () => ({
    appConfig: { settings: { activity_level_overrides: "" }, jwtSecret: "test", security: { allow_self_signed_agent_certificates: false } },
    directoryConfig: { urls: [], bindDn: null, password: null, allowSelfSigned: false, timeoutMs: 15000 },
    readDirectoryCa: () => undefined,
}));

// No test dials anything: an agent that is dialled accepts its registration and is then not there.
vi.mock("../agent/agentDial.js", () => ({
    registerAgent: async () => ({ ok: true, hostname: "dc2" }),
    openAgentSocket: async () => {
        throw new Error("Nothing listens there");
    },
}));

const { default: db } = await import("../core/Database.js");
const { DomainControllerService } = await import("./DomainControllerService.js");
const { DcAgentService } = await import("./DcAgentService.js");
const { DcHealthService } = await import("./DcHealthService.js");
const { ActivityService } = await import("./ActivityService.js");

const DC1 = { id: "11111111-1111-4111-8111-111111111111", name: "DC1", dnsHostName: "dc1.sadm.test", site: "HQ" };
const DC2 = { id: "22222222-2222-4222-8222-222222222222", name: "DC2", dnsHostName: "dc2.sadm.test", site: "HQ" };

const kinds = () => ActivityService.list(0).map((event) => `${event.kind} ${event.subject?.name}`);
const register = (token: string, dcId = DC1.id) => DcAgentService.registerInbound({ token, dcId, hostname: "dc1" });

beforeEach(() => {
    db.exec("DELETE FROM domain_controllers; DELETE FROM activity;");
    DomainControllerService.sync([DC1, DC2]);
    db.exec("DELETE FROM activity;");
});

describe("the registration token", () => {
    it("is stored as its hash only, and for an hour", () => {
        const { token, expiresAt } = DcAgentService.issueToken(DC1.id)!;
        const row = db.prepare("SELECT token_hash FROM agent_registration_tokens WHERE dc_id = ?").get(DC1.id) as { token_hash: string };
        expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.token_hash).not.toContain(token);
        expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(59 * 60_000);
    });

    it("is not issued for a domain controller that does not exist", () => {
        expect(DcAgentService.issueToken("nope")).toBeNull();
    });

    it("stops working once another is issued in its place", () => {
        const first = DcAgentService.issueToken(DC1.id)!;
        const second = DcAgentService.issueToken(DC1.id)!;
        expect(register(first.token)).toMatchObject({ ok: false, status: 401 });
        expect(register(second.token)).toMatchObject({ ok: true });
    });

    it("registers once", () => {
        const { token } = DcAgentService.issueToken(DC1.id)!;
        expect(register(token)).toMatchObject({ ok: true, clientId: DC1.id });
        expect(register(token)).toMatchObject({ ok: false, status: 401 });
    });

    it("is refused once it has expired, and when it was never issued", () => {
        const { token } = DcAgentService.issueToken(DC1.id)!;
        db.prepare("UPDATE agent_registration_tokens SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
        expect(register(token)).toMatchObject({ ok: false, status: 401 });
        expect(register("made-up")).toMatchObject({ ok: false, status: 401 });
    });

    it("is good for the domain controller it was issued for only, and stays good after another one tried it", () => {
        const { token } = DcAgentService.issueToken(DC1.id)!;
        expect(register(token, DC2.id)).toMatchObject({ ok: false, status: 403 });
        expect(DomainControllerService.get(DC2.id)?.agent).toBeNull();
        expect(register(token, DC1.id.toUpperCase())).toMatchObject({ ok: true });
    });
});

describe("an agent", () => {
    const registered = () => {
        const result = register(DcAgentService.issueToken(DC1.id)!.token);
        if (!result.ok) throw new Error(result.error);
        return result;
    };

    it("shows on its domain controller, not connected until it connects, and is recorded", () => {
        registered();
        expect(DomainControllerService.get(DC1.id)?.agent).toMatchObject({
            connectionMode: "inbound",
            connected: false,
            hostname: "dc1",
            lastSeen: null,
            capabilities: [],
        });
        expect(DomainControllerService.get(DC2.id)?.agent).toBeNull();
        expect(kinds()).toEqual(["agent.registered DC1"]);
    });

    it("is known by the identity it was issued, both halves of it", () => {
        const { token, clientId } = registered();
        expect(DcAgentService.authenticateInbound(clientId, token)).toBe(DC1.id);
        expect(DcAgentService.authenticateInbound(clientId.toUpperCase(), token)).toBe(DC1.id);
        expect(DcAgentService.authenticateInbound(clientId, "another")).toBeNull();
        expect(DcAgentService.authenticateInbound(DC2.id, token)).toBeNull();
    });

    it("is stored by the hash of its token only", () => {
        const { token } = registered();
        const row = db.prepare("SELECT auth_token_hash, token_nonce FROM dc_agents WHERE dc_id = ?").get(DC1.id) as Record<string, string | null>;
        expect(row.auth_token_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.auth_token_hash).not.toContain(token);
        expect(row.token_nonce).toBeNull();
    });

    it("replaces the one before it when it registers again", () => {
        const first = registered();
        const second = registered();
        expect(DcAgentService.authenticateInbound(first.clientId, first.token)).toBeNull();
        expect(DcAgentService.authenticateInbound(second.clientId, second.token)).toBe(DC1.id);
    });

    it("takes what it reported with it when it is removed, and says who removed it", () => {
        const { token, clientId } = registered();
        DcHealthService.storeMeasurement(DC1.id, { collectedAt: "2026-10-11T00:00:00.000Z", services: [], errors: [] });
        DcHealthService.storeDbcheck(DC1.id, { checkedAt: "2026-10-11T00:00:00Z", errors: 2 });
        DcHealthService.storeLocal(DC1.id, { collectedAt: "2026-10-11T00:00:00Z" });
        expect(DcHealthService.get(DC1.id)).toMatchObject({ dbcheck: { errors: 2 }, local: { errors: [] } });

        expect(DcAgentService.remove(DC1.id, "admin")).toBe(true);
        expect(DomainControllerService.get(DC1.id)?.agent).toBeNull();
        expect(DcAgentService.authenticateInbound(clientId, token)).toBeNull();
        expect(DcHealthService.get(DC1.id)).toMatchObject({ dbcheck: null, local: null });
        expect(kinds()).toContain("agent.removed DC1");
        expect(DcAgentService.remove(DC1.id, "admin")).toBe(false);
    });

    it("goes with a domain controller the directory no longer lists", () => {
        registered();
        DomainControllerService.sync([DC2]);
        expect(db.prepare("SELECT COUNT(*) AS n FROM dc_agents").get()).toEqual({ n: 0 });
    });

    it("cannot be asked for a database check while it is not connected, or where there is none", () => {
        expect(DcAgentService.requestDbcheck(DC1.id)).toBe("no-agent");
        registered();
        expect(DcAgentService.requestDbcheck(DC1.id)).toBe("offline");
    });
});

describe("the address an agent is dialled at", () => {
    const address = () => DomainControllerService.get(DC2.id)?.agent?.targetAddress;

    it("can be set for one the server dials, which stays the agent it was", async () => {
        expect(await DcAgentService.connectOutbound(DC2.id, "dc2.sadm.test:3021", "PIN")).toEqual({ ok: true });
        const before = db.prepare("SELECT auth_token_hash, token_nonce, registered_at FROM dc_agents WHERE dc_id = ?").get(DC2.id);
        db.exec("DELETE FROM activity;");

        expect(await DcAgentService.setTargetAddress(DC2.id, "10.0.0.2:3021", "admin")).toBeNull();
        expect(address()).toBe("10.0.0.2:3021");
        expect(db.prepare("SELECT auth_token_hash, token_nonce, registered_at FROM dc_agents WHERE dc_id = ?").get(DC2.id)).toEqual(before);
        expect(ActivityService.list(0)[0]).toMatchObject({
            kind: "agent.updated",
            data: { targetAddress: "10.0.0.2:3021", was: "dc2.sadm.test:3021", actor: "admin" },
        });
        // Stops the attempts to reach it, which nothing else in a test would.
        DcAgentService.remove(DC2.id, null);
    });

    it("is not recorded as changed when it is the one it has", async () => {
        await DcAgentService.connectOutbound(DC2.id, "dc2.sadm.test:3021", "PIN");
        db.exec("DELETE FROM activity;");
        expect(await DcAgentService.setTargetAddress(DC2.id, "dc2.sadm.test:3021", "admin")).toBeNull();
        expect(kinds()).toEqual([]);
        DcAgentService.remove(DC2.id, null);
    });

    it("is refused for an agent that dials the server itself, and where there is none", async () => {
        expect(await DcAgentService.setTargetAddress(DC1.id, "dc1.sadm.test:3021", "admin")).toBe("no-agent");
        register(DcAgentService.issueToken(DC1.id)!.token);
        expect(await DcAgentService.setTargetAddress(DC1.id, "dc1.sadm.test:3021", "admin")).toBe("inbound");
        expect(DomainControllerService.get(DC1.id)?.agent?.targetAddress).toBeNull();
    });
});

describe("what an agent reports", () => {
    it("is dropped when it is not a report", () => {
        DcHealthService.storeMeasurement(DC1.id, { collectedAt: "2026-10-11T00:00:00.000Z", services: [], errors: [] });
        DcHealthService.storeDbcheck(DC1.id, { errors: "many" });
        DcHealthService.storeLocal(DC1.id, { services: [] });
        expect(DcHealthService.get(DC1.id)).toMatchObject({ dbcheck: null, local: null });
    });
});
