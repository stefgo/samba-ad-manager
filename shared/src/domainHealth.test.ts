import { describe, expect, it } from "vitest";
import type { DcHealth, DcService } from "./dcHealth.js";
import {
    buildDomainHealth,
    domainHealthOptionsFromSettings,
    formatDuration,
    functionalLevelLabel,
    type DomainHealthController,
} from "./domainHealth.js";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const options = { now: NOW };
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const ID = { DC1: "11111111-1111-4111-8111-111111111111", DC2: "22222222-2222-4222-8222-222222222222" };

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

const service = (name: string, port: number, ok = true, over: Partial<DcService> = {}): DcService => ({
    name,
    port,
    check: "connect",
    ok,
    ...over,
});
const SERVICES = [service("Kerberos", 88, true, { check: "protocol" }), service("LDAP", 389), service("Global catalog", 3268)];

const health = (name: "DC1" | "DC2", over: Partial<DcHealth> = {}): DcHealth => ({
    dcId: ID[name],
    collectedAt: ago(0),
    clockOffsetMs: 20,
    identity: { name, dnsHostName: `${name.toLowerCase()}.sadm.test`, site: "Default-First-Site-Name", isSynchronized: true },
    domain: {
        dn: "DC=sadm,DC=test",
        dnsName: "sadm.test",
        domainLevel: 4,
        forestLevel: 4,
        fsmo: ALL_ON_DC1,
        controllers: [
            { id: ID.DC1, name: "DC1", isGlobalCatalog: true },
            { id: ID.DC2, name: "DC2", isGlobalCatalog: false },
        ],
        counts: { users: 4, groups: 40, computers: 2 },
    },
    replication: { collectedAt: ago(0), inbound: [link(name === "DC1" ? "DC2" : "DC1")], outbound: [] },
    services: SERVICES,
    errors: [],
    ...over,
});

/** A measurement of a domain controller that answered nothing at all. */
const silent = (name: "DC1" | "DC2"): DcHealth =>
    health(name, {
        identity: null,
        domain: null,
        replication: null,
        clockOffsetMs: null,
        services: SERVICES.map((s) => ({ ...s, ok: false, detail: "timed out" })),
    });

const dc = (name: "DC1" | "DC2", over: Partial<DomainHealthController> = {}): DomainHealthController => ({
    id: ID[name],
    name,
    ...over,
});
const listed = [dc("DC1"), dc("DC2")];
const both = (overA: Partial<DcHealth> = {}, overB: Partial<DcHealth> = {}) => ({
    [ID.DC1]: health("DC1", overA),
    [ID.DC2]: health("DC2", overB),
});
const types = (domain: ReturnType<typeof buildDomainHealth>) => domain.issues.map((issue) => issue.type);

describe("buildDomainHealth", () => {
    it("is healthy when every domain controller reports nothing wrong", () => {
        const domain = buildDomainHealth(listed, both(), options);
        expect(domain.status).toBe("healthy");
        expect(domain.issues).toEqual([]);
        expect(domain).toMatchObject({ dnsName: "sadm.test", dn: "DC=sadm,DC=test", domainLevel: 4 });
        expect(domain.counts).toEqual({ users: 4, groups: 40, computers: 2 });
        expect(domain.controllers.map((c) => [c.name, c.status, c.id])).toEqual([
            ["DC1", "healthy", ID.DC1],
            ["DC2", "healthy", ID.DC2],
        ]);
    });

    it("gives each role to the domain controller all agree on", () => {
        const domain = buildDomainHealth(listed, both(), options);
        expect(domain.fsmo.pdc).toEqual({ holder: "DC1", holders: ["DC1"] });
        expect(domain.controllers[0].roles).toHaveLength(7);
        expect(domain.controllers[1].roles).toEqual([]);
    });

    it("knows nothing without a measurement", () => {
        const domain = buildDomainHealth(listed, {}, options);
        expect(domain.status).toBe("unknown");
        expect(domain.dnsName).toBeNull();
        expect(domain.controllers.map((c) => [c.name, c.status])).toEqual([
            ["DC1", "unknown"],
            ["DC2", "unknown"],
        ]);
    });

    it("knows nothing while the directory lists no domain controller", () => {
        expect(buildDomainHealth([], {}, options)).toMatchObject({ status: "unknown", controllers: [], issues: [] });
    });

    it("does not judge a domain controller that has not been measured yet", () => {
        const domain = buildDomainHealth(listed, { [ID.DC1]: health("DC1") }, options);
        expect(domain.status).toBe("healthy");
        expect(domain.controllers[1]).toMatchObject({ name: "DC2", status: "unknown", health: null, isGlobalCatalog: false });
    });

    it("says of a domain controller that answers nothing that it is unreachable, and nothing else", () => {
        const domain = buildDomainHealth(listed, { [ID.DC1]: health("DC1"), [ID.DC2]: silent("DC2") }, options);
        expect(domain.status).toBe("critical");
        expect(domain.issues).toEqual([
            expect.objectContaining({ type: "dc-unreachable", dc: "DC2", dcId: ID.DC2, severity: "error" }),
        ]);
        // What it cannot say of itself, the one that answered knows.
        expect(domain.controllers[1]).toMatchObject({ status: "critical", isGlobalCatalog: false });
        expect(domain.dnsName).toBe("sadm.test");
    });

    it("is critical, not unknown, when no domain controller answers", () => {
        const domain = buildDomainHealth(listed, { [ID.DC1]: silent("DC1"), [ID.DC2]: silent("DC2") }, options);
        expect(domain.status).toBe("critical");
        expect(types(domain)).toEqual(["dc-unreachable", "dc-unreachable"]);
        expect(domain.dnsName).toBeNull();
    });

    it("rates a service that does not answer by whether a domain controller needs it, and says why", () => {
        const services = [
            service("Kerberos", 88, false, { check: "protocol", detail: "timed out" }),
            service("LDAP", 389),
            service("Global catalog", 3268, false),
        ];
        const domain = buildDomainHealth(listed, both({ services }), options);
        expect(domain.issues.map((issue) => [issue.type, issue.severity, issue.text])).toEqual([
            ["service-down", "error", "DC1: Kerberos (port 88) does not answer: timed out"],
            ["service-down", "warning", "DC1: Global catalog (port 3268) does not answer"],
        ]);
    });

    it("reports failing replication once per partner, with the worst link", () => {
        const inbound = [
            link("DC2", { consecutiveFailures: 2, resultCode: 1722, resultText: "WERR_RPC_S_SERVER_UNAVAILABLE" }),
            link("DC2", { namingContext: "CN=Configuration,DC=sadm,DC=test", consecutiveFailures: 5, resultText: "WERR_X" }),
        ];
        const domain = buildDomainHealth(listed, both({ replication: { collectedAt: ago(0), inbound, outbound: [] } }), options);
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
        const domain = buildDomainHealth(listed, both({ replication: { collectedAt: ago(0), inbound, outbound: [] } }), options);
        expect(domain.issues[0]).toMatchObject({
            type: "replication-stale",
            severity: "warning",
            text: "DC1: last replicated from DC2 2 h 5 min ago",
        });
    });

    it("leaves a link alone that nobody has tried yet, and reports one that never succeeded", () => {
        const fresh = [link("DC2", { lastAttempt: null, lastSuccess: null })];
        expect(
            buildDomainHealth(listed, both({ replication: { collectedAt: ago(0), inbound: fresh, outbound: [] } }), options).issues,
        ).toEqual([]);
        const never = [link("DC2", { lastSuccess: null })];
        expect(
            types(buildDomainHealth(listed, both({ replication: { collectedAt: ago(0), inbound: never, outbound: [] } }), options)),
        ).toEqual(["replication-stale"]);
    });

    it("does not judge an outbound link, which keeps no times", () => {
        const outbound = [link("DC2", { lastAttempt: null, lastSuccess: null, consecutiveFailures: 3 })];
        expect(buildDomainHealth(listed, both({ replication: { collectedAt: ago(0), inbound: [], outbound } }), options).issues).toEqual([]);
    });

    it("reports a role the domain controllers disagree about, and gives it to nobody", () => {
        const domain = buildDomainHealth(
            listed,
            both({}, { domain: { ...health("DC2").domain!, fsmo: { ...ALL_ON_DC1, pdc: "dc2" } } }),
            options,
        );
        expect(domain.fsmo.pdc).toEqual({ holder: null, holders: ["DC1", "DC2"] });
        expect(domain.issues[0]).toMatchObject({ type: "fsmo-conflict", severity: "error" });
        expect(domain.issues[0].dc).toBeUndefined();
        expect(domain.controllers[0].roles).not.toContain("pdc");
    });

    it("reports a role nobody holds", () => {
        const fsmo = { ...ALL_ON_DC1, rid: null };
        const view = { ...health("DC1").domain!, fsmo };
        const domain = buildDomainHealth(listed, both({ domain: view }, { domain: view }), options);
        expect(domain.issues[0]).toMatchObject({
            type: "fsmo-missing",
            text: "RID master: no domain controller holds the role",
        });
    });

    it("reports a clock beyond what Kerberos tolerates, and says which way", () => {
        const domain = buildDomainHealth(listed, both({ clockOffsetMs: -400_000 }, { clockOffsetMs: 299_000 }), options);
        expect(domain.issues).toEqual([
            expect.objectContaining({ type: "clock-offset", text: "DC1: its clock is 6 min behind this server's" }),
        ]);
        const strict = buildDomainHealth(listed, both({}, { clockOffsetMs: 61_000 }), { ...options, maxClockOffsetSeconds: 60 });
        expect(strict.issues[0].text).toBe("DC2: its clock is 1 min ahead of this server's");
    });

    it("reports what the database check found, and a DC that is still synchronizing", () => {
        const domain = buildDomainHealth(
            listed,
            both(
                { dbcheck: { checkedAt: ago(5), receivedAt: ago(5), errors: 3 } },
                { identity: { name: "DC2", isSynchronized: false }, dbcheck: { checkedAt: ago(5), receivedAt: ago(5), errors: 0 } },
            ),
            options,
        );
        expect(domain.issues.map((issue) => [issue.dc, issue.type])).toEqual([
            ["DC1", "dbcheck-errors"],
            ["DC2", "not-synchronized"],
        ]);
        expect(domain.status).toBe("degraded");
    });

    it("reports a database check that could not be run", () => {
        const dbcheck = { checkedAt: ago(5), receivedAt: ago(5), errors: null, error: "ImportError: No module named samba" };
        expect(buildDomainHealth(listed, both({ dbcheck }), options).issues[0]).toMatchObject({
            type: "dbcheck-errors",
            text: "DC1: the database check could not be run (ImportError: No module named samba)",
        });
    });

    it("expects no database check from a domain controller that has no token for one", () => {
        const old = { checkedAt: ago(60 * 100), receivedAt: ago(60 * 100), errors: 0 };
        expect(buildDomainHealth(listed, both({ dbcheck: old }), options).issues).toEqual([]);
    });

    it("reports a database check that is overdue, counted from the last report", () => {
        const expecting = [dc("DC1", { dbcheckSince: ago(60 * 24 * 30) }), dc("DC2")];
        const fresh = { checkedAt: ago(60 * 35), receivedAt: ago(60 * 35), errors: 0 };
        expect(buildDomainHealth(expecting, both({ dbcheck: fresh }), options).issues).toEqual([]);
        const late = { checkedAt: ago(60 * 37), receivedAt: ago(60 * 37), errors: 0 };
        expect(buildDomainHealth(expecting, both({ dbcheck: late }), options).issues[0]).toMatchObject({
            type: "dbcheck-overdue",
            severity: "warning",
            text: "DC1: the last database check was reported 1 d 13 h ago",
        });
        expect(types(buildDomainHealth(expecting, both({ dbcheck: fresh }), { ...options, maxDbcheckAgeHours: 24 }))).toEqual([
            "dbcheck-overdue",
        ]);
    });

    it("waits from the moment the token was issued for the first report", () => {
        const justNow = buildDomainHealth([dc("DC1", { dbcheckSince: ago(60) }), dc("DC2")], both(), options);
        expect(justNow.issues).toEqual([]);
        const longAgo = buildDomainHealth([dc("DC1", { dbcheckSince: ago(60 * 40) }), dc("DC2")], both(), options);
        expect(longAgo.issues[0]).toMatchObject({ type: "dbcheck-overdue", text: "DC1: no database check has been reported yet" });
    });

    it("reports an overdue database check next to a domain controller that is unreachable", () => {
        const expecting = [dc("DC1"), dc("DC2", { dbcheckSince: ago(60 * 40) })];
        const domain = buildDomainHealth(expecting, { [ID.DC1]: health("DC1"), [ID.DC2]: silent("DC2") }, options);
        expect(types(domain)).toEqual(["dc-unreachable"]);
    });

    it("puts the domain's own findings first", () => {
        const fsmo = { ...ALL_ON_DC1, rid: null };
        const view = { ...health("DC1").domain!, fsmo };
        const domain = buildDomainHealth(
            listed,
            both({ domain: view, dbcheck: { checkedAt: ago(5), receivedAt: ago(5), errors: 1 } }, { domain: view }),
            options,
        );
        expect(types(domain)).toEqual(["fsmo-missing", "dbcheck-errors"]);
    });
});

describe("the identity of a finding", () => {
    it("stays the same while its text counts on", () => {
        const failing = (failures: number) =>
            buildDomainHealth(
                listed,
                both({ replication: { collectedAt: ago(0), inbound: [link("DC2", { consecutiveFailures: failures })], outbound: [] } }),
                options,
            ).issues[0];
        expect(failing(1).id).toBe(failing(7).id);
        expect(failing(1).text).not.toBe(failing(7).text);
    });

    it("tells two findings of one kind on one domain controller apart", () => {
        const services = [service("Kerberos", 88), service("LDAP", 389, false), service("SMB", 445, false)];
        const ids = buildDomainHealth(listed, both({ services }), options).issues.map((issue) => issue.id);
        expect(ids).toEqual(["service-down|DC1|389", "service-down|DC1|445"]);
    });

    it("names the role for a finding about the domain", () => {
        const view = { ...health("DC1").domain!, fsmo: { ...ALL_ON_DC1, rid: null } };
        expect(buildDomainHealth(listed, both({ domain: view }, { domain: view }), options).issues[0].id).toBe("fsmo-missing||rid");
    });
});

describe("domainHealthOptionsFromSettings", () => {
    it("reads the thresholds as the settings block holds them", () => {
        expect(
            domainHealthOptionsFromSettings({
                health_max_clock_offset_seconds: "120",
                health_max_replication_age_minutes: 30,
                health_max_dbcheck_age_hours: "48",
            }),
        ).toEqual({ maxClockOffsetSeconds: 120, maxReplicationAgeMinutes: 30, maxDbcheckAgeHours: 48 });
    });

    it("falls back to the defaults for what is missing, zero or no number", () => {
        const defaults = { maxClockOffsetSeconds: 300, maxReplicationAgeMinutes: 60, maxDbcheckAgeHours: 36 };
        expect(domainHealthOptionsFromSettings({ health_max_clock_offset_seconds: "0", health_max_replication_age_minutes: "soon" })).toEqual(
            defaults,
        );
        expect(domainHealthOptionsFromSettings({})).toEqual(defaults);
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
