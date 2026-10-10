import { describe, expect, it } from "vitest";
import type { DcHealth } from "./dcHealth.js";
import {
    buildDomainHealth,
    domainHealthOptionsFromSettings,
    formatDuration,
    functionalLevelLabel,
    type DomainHealthClient,
} from "./domainHealth.js";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const options = { now: NOW };
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const ALL_ON_DC1 = {
    schema: "DC1",
    naming: "DC1",
    pdc: "DC1",
    rid: "DC1",
    infrastructure: "DC1",
    domainDns: "DC1",
    forestDns: "DC1",
};

const link = (partner: string, over: Record<string, unknown> = {}) => ({
    namingContext: "DC=sadm,DC=test",
    partner,
    lastAttempt: ago(1),
    lastSuccess: ago(1),
    consecutiveFailures: 0,
    resultCode: 0,
    ...over,
});

const health = (clientId: string, name: string, over: Partial<DcHealth> = {}): DcHealth => ({
    clientId,
    collectedAt: ago(0),
    receivedAt: ago(0),
    clockOffsetMs: 20,
    container: { name: "samba", state: "running", running: true },
    identity: { name, dnsHostName: `${name.toLowerCase()}.sadm.test`, site: "Default-First-Site-Name", isSynchronized: true },
    domain: {
        dn: "DC=sadm,DC=test",
        dnsName: "sadm.test",
        domainLevel: 4,
        forestLevel: 4,
        fsmo: ALL_ON_DC1,
        controllers: [{ name: "DC1" }, { name: "DC2" }],
        counts: { users: 4, groups: 40, computers: 2 },
    },
    replication: { collectedAt: ago(0), inbound: [link(name === "DC1" ? "DC2" : "DC1")], outbound: [] },
    processes: ["ldap_server", "kdc_server", "rpc_server", "dreplsrv"].map((service) => ({ name: service, pids: [1] })),
    ports: [{ name: "LDAP", port: 389, open: true }],
    errors: [],
    ...over,
});

const client = (id: string, status = "online"): DomainHealthClient => ({ id, hostname: `${id}-host`, status });
const clients = [client("a"), client("b")];
const both = (overA: Partial<DcHealth> = {}, overB: Partial<DcHealth> = {}) => ({
    a: health("a", "DC1", overA),
    b: health("b", "DC2", overB),
});
const types = (domain: ReturnType<typeof buildDomainHealth>) => domain.issues.map((issue) => issue.type);

describe("buildDomainHealth", () => {
    it("is healthy when every domain controller reports nothing wrong", () => {
        const domain = buildDomainHealth(clients, both(), options);
        expect(domain.status).toBe("healthy");
        expect(domain.issues).toEqual([]);
        expect(domain).toMatchObject({ dnsName: "sadm.test", dn: "DC=sadm,DC=test", domainLevel: 4 });
        expect(domain.counts).toEqual({ users: 4, groups: 40, computers: 2 });
        expect(domain.controllers.map((dc) => [dc.name, dc.status, dc.clientId])).toEqual([
            ["DC1", "healthy", "a"],
            ["DC2", "healthy", "b"],
        ]);
    });

    it("gives each role to the domain controller all agree on", () => {
        const domain = buildDomainHealth(clients, both(), options);
        expect(domain.fsmo.pdc).toEqual({ holder: "DC1", holders: ["DC1"] });
        expect(domain.controllers[0].roles).toHaveLength(7);
        expect(domain.controllers[1].roles).toEqual([]);
    });

    it("knows nothing without a measurement", () => {
        const domain = buildDomainHealth(clients, {}, options);
        expect(domain.status).toBe("unknown");
        expect(domain.dnsName).toBeNull();
        expect(domain.controllers.map((dc) => [dc.name, dc.status])).toEqual([
            ["a-host", "unknown"],
            ["b-host", "unknown"],
        ]);
    });

    it("knows nothing when every agent is offline, whatever they last measured", () => {
        const domain = buildDomainHealth([client("a", "offline"), client("b", "offline")], both(), options);
        expect(domain.status).toBe("unknown");
        expect(types(domain)).toEqual(["agent-offline", "agent-offline"]);
    });

    it("is degraded while one agent is offline, and does not judge that DC by its last measurement", () => {
        const stale = both({}, { container: { name: "samba", state: "exited", running: false } });
        const domain = buildDomainHealth([client("a"), client("b", "offline")], stale, options);
        expect(domain.status).toBe("degraded");
        expect(types(domain)).toEqual(["agent-offline"]);
        expect(domain.controllers[1]).toMatchObject({ name: "DC2", status: "unknown", online: false });
    });

    it("names a connected agent that has nothing to measure from, and does not judge its last measurement", () => {
        const stale = both({}, { container: { name: "samba", state: "exited", running: false } });
        const idle = { ...client("b"), capabilities: ["directory"] };
        const domain = buildDomainHealth([{ ...client("a"), capabilities: ["health"] }, idle], stale, options);
        expect(types(domain)).toEqual(["agent-not-measuring"]);
        expect(domain.controllers[1]).toMatchObject({ name: "DC2", status: "unknown", online: true });
    });

    it("knows nothing about the domain when the only agent measures nothing", () => {
        const empty = health("a", "DC1", { container: null, identity: null, domain: null, replication: null, processes: null, ports: null });
        const domain = buildDomainHealth([{ ...client("a"), capabilities: [] }], { a: empty }, options);
        expect(domain.status).toBe("unknown");
        expect(domain.issues.map((issue) => issue.id)).toEqual(["agent-not-measuring|A-HOST|"]);
    });

    it("does not count the domain as an agent that no longer measures saw it", () => {
        const domain = buildDomainHealth([{ ...client("a"), capabilities: [] }], { a: health("a", "DC1") }, options);
        expect(domain.status).toBe("unknown");
        expect(domain.dnsName).toBeNull();
    });

    it("takes an agent to measure when its capabilities are not known, and says offline for one that is away", () => {
        expect(types(buildDomainHealth([{ ...client("a"), capabilities: null }, client("b")], both(), options))).toEqual([]);
        const away = { ...client("b", "offline"), capabilities: [] };
        expect(types(buildDomainHealth([client("a"), away], both(), options))).toEqual(["agent-offline"]);
    });

    it("lists a domain controller of the directory that has no agent", () => {
        const domain = buildDomainHealth([client("a")], { a: health("a", "DC1") }, options);
        expect(domain.controllers.map((dc) => [dc.name, dc.clientId])).toEqual([
            ["DC1", "a"],
            ["DC2", null],
        ]);
        expect(types(domain)).toEqual(["no-agent"]);
        expect(domain.status).toBe("degraded");
    });

    it("says a stopped container and nothing else about that domain controller", () => {
        const domain = buildDomainHealth(
            clients,
            both(
                {},
                { container: { name: "samba", state: "exited", running: false }, identity: null, processes: [], dcName: "DC2" },
            ),
            options,
        );
        expect(domain.status).toBe("critical");
        // Named by what the server remembers of it, so it is not listed a second time as a
        // domain controller without an agent.
        expect(domain.issues).toEqual([
            expect.objectContaining({ type: "container-stopped", dc: "DC2", clientId: "b", severity: "error" }),
        ]);
        expect(domain.controllers).toHaveLength(2);
    });

    it("reports a directory that does not answer", () => {
        const domain = buildDomainHealth(
            clients,
            both({}, { identity: null, domain: null, errors: [{ source: "ldap", message: "connect ECONNREFUSED" }] }),
            options,
        );
        expect(domain.issues[0]).toMatchObject({ type: "ldap-unreachable", severity: "error" });
        expect(domain.issues[0].text).toContain("connect ECONNREFUSED");
    });

    it("reports a required Samba service without a process", () => {
        const processes = [
            { name: "ldap_server", pids: [1] },
            { name: "kdc_server", pids: [] },
            { name: "rpc_server", pids: [2] },
        ];
        const domain = buildDomainHealth(clients, both({ processes }), options);
        expect(domain.issues[0]).toMatchObject({
            type: "samba-not-running",
            text: "DC1: Samba service not running: kdc_server, dreplsrv",
        });
    });

    it("rates a closed port by whether a domain controller needs it", () => {
        const ports = [
            { name: "LDAP", port: 389, open: false },
            { name: "Global catalog", port: 3268, open: false },
        ];
        const domain = buildDomainHealth(clients, both({ ports }), options);
        expect(domain.issues.map((issue) => [issue.type, issue.severity])).toEqual([
            ["port-closed", "error"],
            ["port-closed", "warning"],
        ]);
    });

    it("reports failing replication once per partner, with the worst link", () => {
        const inbound = [
            link("DC2", { consecutiveFailures: 2, resultCode: 1722, resultText: "WERR_RPC_S_SERVER_UNAVAILABLE" }),
            link("DC2", { namingContext: "CN=Configuration,DC=sadm,DC=test", consecutiveFailures: 5, resultText: "WERR_X" }),
        ];
        const domain = buildDomainHealth(clients, both({ replication: { collectedAt: ago(0), inbound, outbound: [] } }), options);
        expect(domain.issues).toHaveLength(1);
        expect(domain.issues[0]).toMatchObject({
            type: "replication-failing",
            severity: "error",
            text: "DC1: replication from DC2 failed 5 times in a row (WERR_X)",
        });
        expect(domain.status).toBe("critical");
    });

    it("reports a link that last succeeded too long ago", () => {
        const inbound = [link("DC2", { lastSuccess: ago(125) })];
        const domain = buildDomainHealth(clients, both({ replication: { collectedAt: ago(0), inbound, outbound: [] } }), options);
        expect(domain.issues[0]).toMatchObject({
            type: "replication-stale",
            severity: "warning",
            text: "DC1: last replicated from DC2 2 h 5 min ago",
        });
    });

    it("leaves a link alone that nobody has tried yet, and reports one that never succeeded", () => {
        const fresh = [link("DC2", { lastAttempt: null, lastSuccess: null })];
        expect(
            buildDomainHealth(clients, both({ replication: { collectedAt: ago(0), inbound: fresh, outbound: [] } }), options).issues,
        ).toEqual([]);
        const never = [link("DC2", { lastSuccess: null })];
        expect(
            types(buildDomainHealth(clients, both({ replication: { collectedAt: ago(0), inbound: never, outbound: [] } }), options)),
        ).toEqual(["replication-stale"]);
    });

    it("reports a role the domain controllers disagree about, and gives it to nobody", () => {
        const domain = buildDomainHealth(
            clients,
            both({}, { domain: { ...health("b", "DC2").domain!, fsmo: { ...ALL_ON_DC1, pdc: "dc2" } } }),
            options,
        );
        expect(domain.fsmo.pdc).toEqual({ holder: null, holders: ["DC1", "DC2"] });
        expect(domain.issues[0]).toMatchObject({ type: "fsmo-conflict", severity: "error" });
        expect(domain.issues[0].dc).toBeUndefined();
        expect(domain.controllers[0].roles).not.toContain("pdc");
    });

    it("reports a role nobody holds", () => {
        const fsmo = { ...ALL_ON_DC1, rid: null };
        const view = { ...health("a", "DC1").domain!, fsmo };
        const domain = buildDomainHealth(clients, both({ domain: view }, { domain: view }), options);
        expect(domain.issues[0]).toMatchObject({
            type: "fsmo-missing",
            text: "RID master: no domain controller holds the role",
        });
    });

    it("reports a clock beyond what Kerberos tolerates, and says which way", () => {
        const domain = buildDomainHealth(clients, both({ clockOffsetMs: -400_000 }, { clockOffsetMs: 299_000 }), options);
        expect(domain.issues).toEqual([
            expect.objectContaining({ type: "clock-offset", text: "DC1: its clock is 6 min behind this server's" }),
        ]);
        const strict = buildDomainHealth(clients, both({}, { clockOffsetMs: 61_000 }), { ...options, maxClockOffsetSeconds: 60 });
        expect(strict.issues[0].text).toBe("DC2: its clock is 1 min ahead of this server's");
    });

    it("reports what the database check found, and a DC that is still synchronizing", () => {
        const domain = buildDomainHealth(
            clients,
            both(
                { dbcheck: { checkedAt: ago(5), errors: 3 } },
                { identity: { name: "DC2", isSynchronized: false }, dbcheck: { checkedAt: ago(5), errors: 0 } },
            ),
            options,
        );
        expect(domain.issues.map((issue) => [issue.dc, issue.type])).toEqual([
            ["DC1", "dbcheck-errors"],
            ["DC2", "not-synchronized"],
        ]);
        expect(domain.status).toBe("degraded");
    });

    it("puts the domain's own findings first", () => {
        const fsmo = { ...ALL_ON_DC1, rid: null };
        const view = { ...health("a", "DC1").domain!, fsmo };
        const domain = buildDomainHealth(
            clients,
            both({ domain: view, dbcheck: { checkedAt: ago(5), errors: 1 } }, { domain: view }),
            options,
        );
        expect(types(domain)).toEqual(["fsmo-missing", "dbcheck-errors"]);
    });
});

describe("the identity of a finding", () => {
    it("stays the same while its text counts on", () => {
        const failing = (failures: number) =>
            buildDomainHealth(
                clients,
                both({ replication: { collectedAt: ago(0), inbound: [link("DC2", { consecutiveFailures: failures })], outbound: [] } }),
                options,
            ).issues[0];
        expect(failing(1).id).toBe(failing(7).id);
        expect(failing(1).text).not.toBe(failing(7).text);
    });

    it("tells two findings of one kind on one domain controller apart", () => {
        const ports = [
            { name: "LDAP", port: 389, open: false },
            { name: "SMB", port: 445, open: false },
        ];
        const ids = buildDomainHealth(clients, both({ ports }), options).issues.map((issue) => issue.id);
        expect(ids).toEqual(["port-closed|DC1|389", "port-closed|DC1|445"]);
    });

    it("names the role for a finding about the domain", () => {
        const view = { ...health("a", "DC1").domain!, fsmo: { ...ALL_ON_DC1, rid: null } };
        expect(buildDomainHealth(clients, both({ domain: view }, { domain: view }), options).issues[0].id).toBe("fsmo-missing||rid");
    });
});

describe("domainHealthOptionsFromSettings", () => {
    it("reads the thresholds as the settings block holds them", () => {
        expect(
            domainHealthOptionsFromSettings({ health_max_clock_offset_seconds: "120", health_max_replication_age_minutes: 30 }),
        ).toEqual({ maxClockOffsetSeconds: 120, maxReplicationAgeMinutes: 30 });
    });

    it("falls back to the defaults for what is missing, zero or no number", () => {
        expect(domainHealthOptionsFromSettings({ health_max_clock_offset_seconds: "0", health_max_replication_age_minutes: "soon" })).toEqual({
            maxClockOffsetSeconds: 300,
            maxReplicationAgeMinutes: 60,
        });
        expect(domainHealthOptionsFromSettings({})).toEqual({ maxClockOffsetSeconds: 300, maxReplicationAgeMinutes: 60 });
    });
});

describe("formatDuration", () => {
    it("writes a span the way a reader says it", () => {
        expect(formatDuration(42)).toBe("42 s");
        expect(formatDuration(180)).toBe("3 min");
        expect(formatDuration(7500)).toBe("2 h 5 min");
        expect(formatDuration(97200)).toBe("1 d 3 h");
    });
});

describe("functionalLevelLabel", () => {
    it("names the Windows Server release a level stands for", () => {
        expect(functionalLevelLabel(4)).toBe("2008 R2");
        expect(functionalLevelLabel(7)).toBe("2016");
        expect(functionalLevelLabel(null)).toBe("–");
        expect(functionalLevelLabel(99)).toBe("99");
    });
});
