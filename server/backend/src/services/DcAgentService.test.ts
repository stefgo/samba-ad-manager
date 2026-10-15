import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

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
const { AgentHub } = await import("../agent/AgentHub.js");
const { directoryConfig } = await import("../config/AppConfig.js");

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

describe("fixing a domain controller's database", () => {
    const sent: string[] = [];
    const socket = { readyState: WebSocket.OPEN, send: (data: string) => sent.push(JSON.parse(data).type), close: () => {} } as unknown as WebSocket;

    /** An agent of DC1 that is connected and says it can do what `capabilities` name. */
    const connected = (capabilities: string[]) => {
        const result = register(DcAgentService.issueToken(DC1.id)!.token);
        if (!result.ok) throw new Error(result.error);
        db.prepare("UPDATE dc_agents SET capabilities = ? WHERE dc_id = ?").run(JSON.stringify(capabilities), DC1.id);
        AgentHub.register(DC1.id, socket);
        db.exec("DELETE FROM activity;");
    };

    afterEach(() => {
        AgentHub.unregister(DC1.id, socket);
        sent.length = 0;
        (directoryConfig as { readOnly?: boolean }).readOnly = false;
    });

    it("is asked of a connected agent that offers it, and says who asked", () => {
        connected(["dbcheck", "dbcheck-fix"]);
        expect(DcAgentService.requestDbcheckFix(DC1.id, "admin")).toBeNull();
        expect(sent).toEqual(["REQUEST_DBCHECK_FIX"]);
        expect(ActivityService.list(0)[0]).toMatchObject({ kind: "agent.dbcheck_fix_requested", level: "info", data: { actor: "admin" } });
    });

    it("is not asked of an agent whose operator did not allow it", () => {
        connected(["dbcheck"]);
        expect(DcAgentService.requestDbcheckFix(DC1.id, "admin")).toBe("unsupported");
        expect(sent).toEqual([]);
        expect(kinds()).toEqual([]);
    });

    it("is not asked of an agent that is not connected, or where there is none", () => {
        expect(DcAgentService.requestDbcheckFix(DC1.id, "admin")).toBe("no-agent");
        connected(["dbcheck", "dbcheck-fix"]);
        AgentHub.unregister(DC1.id, socket);
        expect(DcAgentService.requestDbcheckFix(DC1.id, "admin")).toBe("offline");
    });

    it("is not asked at all by a server that may change nothing", () => {
        connected(["dbcheck", "dbcheck-fix"]);
        (directoryConfig as { readOnly?: boolean }).readOnly = true;
        expect(DcAgentService.requestDbcheckFix(DC1.id, "admin")).toBe("read-only");
        expect(sent).toEqual([]);
        // A check only reads, and stays possible.
        expect(DcAgentService.requestDbcheck(DC1.id)).toBeNull();
    });

    it("is recorded with how it went when the check after it arrives", () => {
        const check = { checkedAt: "2026-10-11T00:10:00Z" };
        const fix = { fixedAt: "2026-10-11T00:05:00Z" };
        DcAgentService.receiveDbcheck(DC1.id, { ...check, errors: 0, fix: { ...fix, errorsFound: 3 } });
        DcAgentService.receiveDbcheck(DC1.id, { ...check, errors: 1, fix: { ...fix, errorsFound: 3 } });
        DcAgentService.receiveDbcheck(DC1.id, { ...check, errors: 3, fix: { ...fix, errorsFound: null, error: "locked" } });
        // A check on its own is no fix.
        DcAgentService.receiveDbcheck(DC1.id, { ...check, errors: 3 });

        // Written within the same millisecond, so in no order to rely on.
        const events = ActivityService.list(0).map(({ kind, level, data }) => ({ kind, level, data }));
        expect(events).toHaveLength(3);
        expect(events).toEqual(
            expect.arrayContaining([
                { kind: "agent.dbcheck_fixed", level: "info", data: expect.objectContaining({ errorsFound: 3, errorsRemaining: 0 }) },
                { kind: "agent.dbcheck_fixed", level: "warning", data: expect.objectContaining({ errorsFound: 3, errorsRemaining: 1 }) },
                {
                    kind: "agent.dbcheck_fixed",
                    level: "error",
                    data: expect.objectContaining({ errorsFound: null, errorsRemaining: 3, error: "locked" }),
                },
            ]),
        );
    });
});

describe("an operation the agent tries again", () => {
    const sent: { type: string; payload: Record<string, unknown> }[] = [];
    const socket = {
        readyState: WebSocket.OPEN,
        send: (data: string) => sent.push(JSON.parse(data)),
        close: () => {},
    } as unknown as WebSocket;

    const connected = () => {
        const result = register(DcAgentService.issueToken(DC1.id)!.token);
        if (!result.ok) throw new Error(result.error);
        db.prepare("UPDATE dc_agents SET capabilities = ? WHERE dc_id = ?").run(
            JSON.stringify(["dbcheck", "dbcheck-fix", "replication-sync"]),
            DC1.id,
        );
        AgentHub.register(DC1.id, socket);
        db.exec("DELETE FROM activity;");
    };

    /** The events of the activity, oldest first, with what a test looks at. */
    const events = () =>
        ActivityService.list(0)
            .map(({ kind, level, correlationId, data, occurredAt }) => ({ kind, level, correlationId, data, occurredAt }))
            .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    const check = { checkedAt: "2026-10-15T12:10:00Z" };
    const fixedAt = "2026-10-15T12:05:00Z";

    beforeEach(() => {
        vi.useFakeTimers();
        connected();
    });

    afterEach(() => {
        DcAgentService.remove(DC1.id, null);
        AgentHub.unregister(DC1.id, socket);
        sent.length = 0;
        vi.useRealTimers();
    });

    it("sends the fix with its correlation id and the settings, and records the request under that id", () => {
        expect(DcAgentService.requestDbcheckFix(DC1.id, "admin")).toBeNull();
        const [request] = sent;
        expect(request.type).toBe("REQUEST_DBCHECK_FIX");
        expect(request.payload).toMatchObject({ retries: 2, retryDelayMinutes: 10 });
        expect(request.payload.correlationId).toMatch(/^[0-9a-f-]{36}$/);
        expect(events()).toEqual([
            expect.objectContaining({ kind: "agent.dbcheck_fix_requested", correlationId: request.payload.correlationId }),
        ]);
    });

    it("records each attempt that is tried again as a step, and the last as the outcome, all in one row", () => {
        DcAgentService.requestDbcheckFix(DC1.id, "admin");
        const id = sent[0].payload.correlationId as string;
        const first = { errorsFound: 3, errorsRemaining: 1 };
        DcAgentService.receiveDbcheck(DC1.id, {
            ...check,
            errors: 1,
            fix: { fixedAt, errorsFound: 3 },
            series: { id, attempt: 1, of: 3, nextAttemptAt: "2026-10-15T12:20:00Z", done: false, history: [first] },
        });
        vi.advanceTimersByTime(1);
        DcAgentService.receiveDbcheck(DC1.id, {
            ...check,
            errors: 0,
            fix: { fixedAt, errorsFound: 1 },
            series: { id, attempt: 2, of: 3, done: true, history: [first, { errorsFound: 1, errorsRemaining: 0 }] },
        });
        expect(events().map(({ kind, level, correlationId }) => [kind, level, correlationId])).toEqual([
            ["agent.dbcheck_fix_requested", "info", id],
            ["agent.dbcheck_fix_attempted", "trace", id],
            ["agent.dbcheck_fixed", "info", id],
        ]);
        expect(events()[2].data).toMatchObject({ attempts: 2, errorsRemaining: 0 });

        // The outcome is in: nothing is late.
        vi.advanceTimersByTime(7 * 3600_000);
        expect(events()).toHaveLength(3);
    });

    it("makes a second request part of the operation under way", () => {
        DcAgentService.requestDbcheckFix(DC1.id, "admin");
        DcAgentService.requestDbcheckFix(DC1.id, "other");
        expect(sent.map((m) => m.payload.correlationId)).toEqual([sent[0].payload.correlationId, sent[0].payload.correlationId]);
        expect(new Set(events().map((e) => e.correlationId)).size).toBe(1);
    });

    it("says so when the outcome is late, and lets an outcome that arrives after all stand beside it", () => {
        DcAgentService.requestDbcheckFix(DC1.id, "admin");
        const id = sent[0].payload.correlationId as string;
        vi.advanceTimersByTime(6 * 3600_000);
        expect(events().at(-1)).toMatchObject({ kind: "agent.dbcheck_fix_unconfirmed", level: "warning", correlationId: id });

        DcAgentService.receiveDbcheck(DC1.id, { ...check, errors: 0, fix: { fixedAt, errorsFound: 2 }, series: { id, attempt: 1, of: 3, done: true } });
        expect(events().at(-1)).toMatchObject({ kind: "agent.dbcheck_fixed", correlationId: id });
    });

    it("records a replication tried again in one row, with whether the domain controller has partners", () => {
        expect(DcAgentService.requestReplicationSync(DC1.id, "admin")).toBeNull();
        const [request] = sent;
        expect(request.type).toBe("REQUEST_REPLICATION_SYNC");
        expect(request.payload).toMatchObject({ retries: 2, retryDelayMinutes: 2, expectPartners: true });
        const id = request.payload.correlationId as string;
        const link = { partner: DC2.id, namingContext: "DC=sadm,DC=test", error: "WERR_X" };
        DcAgentService.receiveReplicationSync(DC1.id, {
            syncedAt: "2026-10-15T12:00:00Z",
            links: [link],
            series: { id, attempt: 1, of: 3, done: false },
        });
        vi.advanceTimersByTime(1);
        DcAgentService.receiveReplicationSync(DC1.id, {
            syncedAt: "2026-10-15T12:02:00Z",
            links: [link],
            series: { id, attempt: 3, of: 3, done: true },
        });
        expect(events().map(({ kind, level }) => [kind, level])).toEqual([
            ["agent.replication_sync_requested", "info"],
            ["agent.replication_sync_attempted", "trace"],
            ["agent.replication_synced", "error"],
        ]);
        DcHealthService.storeMeasurement(DC1.id, { collectedAt: "2026-10-15T12:03:00.000Z", services: [], errors: [] });
        expect(DcHealthService.get(DC1.id)?.replicationSync?.series).toMatchObject({ attempt: 3, done: true });
    });

    it("does not have the only domain controller there is replicate", () => {
        db.exec(`DELETE FROM domain_controllers WHERE id = '${DC2.id}'`);
        expect(DcAgentService.requestReplicationSync(DC1.id, "admin")).toBe("no-partner");
        expect(sent).toEqual([]);
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
