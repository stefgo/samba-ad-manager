import { describe, expect, it } from "vitest";
import type { DcLocal } from "./agent.js";
import type { DcHealth, DcService, ServiceUrlHealth, TlsCertificate } from "./dcHealth.js";
import {
    buildDomainHealth,
    domainHealthOptionsFromSettings,
    formatBytes,
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

/** An agent that is connected and can do everything, registered `minutes` ago. */
const agent = (minutes = 60, over: Partial<NonNullable<DomainHealthController["agent"]>> = {}) => ({
    registeredAt: ago(minutes),
    connected: true,
    capabilities: ["local", "dbcheck"],
    ...over,
});
/** DC1 with an agent, DC2 without. */
const withAgent = (over: Partial<NonNullable<DomainHealthController["agent"]>> = {}, minutes?: number) => [
    dc("DC1", { agent: agent(minutes, over) }),
    dc("DC2"),
];
const local = (over: Partial<DcLocal> = {}): DcLocal => ({ collectedAt: ago(0), receivedAt: ago(0), errors: [], ...over });
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

    it("does not hold a partner that answers nothing against the one that cannot replicate from it", () => {
        const inbound = [
            link("DC2", { consecutiveFailures: 4, resultText: "WERR_RPC_S_SERVER_UNAVAILABLE" }),
            link("dc2", { namingContext: "CN=Configuration,DC=sadm,DC=test", lastSuccess: ago(125) }),
        ];
        const domain = buildDomainHealth(
            listed,
            { [ID.DC1]: health("DC1", { replication: { collectedAt: ago(0), inbound, outbound: [] } }), [ID.DC2]: silent("DC2") },
            options,
        );
        expect(types(domain)).toEqual(["dc-unreachable"]);
        expect(domain.controllers.map((c) => [c.name, c.status])).toEqual([
            ["DC1", "healthy"],
            ["DC2", "critical"],
        ]);
        expect(domain.status).toBe("critical");
    });

    it("still reports failing replication from a partner that has not been measured yet", () => {
        const inbound = [link("DC2", { consecutiveFailures: 4 })];
        const domain = buildDomainHealth(
            listed,
            { [ID.DC1]: health("DC1", { replication: { collectedAt: ago(0), inbound, outbound: [] } }) },
            options,
        );
        expect(types(domain)).toEqual(["replication-failing"]);
        expect(domain.controllers[0].status).toBe("critical");
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
            withAgent(),
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
        expect(buildDomainHealth(withAgent(), both({ dbcheck }), options).issues[0]).toMatchObject({
            type: "dbcheck-errors",
            text: "DC1: the database check could not be run (ImportError: No module named samba)",
        });
    });

    it("expects no database check from a domain controller without an agent, or with one that runs none", () => {
        const old = { checkedAt: ago(60 * 100), receivedAt: ago(60 * 100), errors: 0 };
        expect(buildDomainHealth(listed, both({ dbcheck: old }), options).issues).toEqual([]);
        expect(buildDomainHealth(withAgent({ capabilities: ["local"] }, 60 * 24 * 30), both({ dbcheck: old }), options).issues).toEqual([]);
    });

    it("reports a database check that is overdue, counted from the last report", () => {
        const expecting = withAgent({}, 60 * 24 * 30);
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

    it("waits from the moment the agent registered for the first report", () => {
        const justNow = buildDomainHealth(withAgent({}, 60), both(), options);
        expect(justNow.issues).toEqual([]);
        const longAgo = buildDomainHealth(withAgent({}, 60 * 40), both(), options);
        expect(longAgo.issues[0]).toMatchObject({ type: "dbcheck-overdue", text: "DC1: no database check has been reported yet" });
    });

    it("reports an overdue database check next to a domain controller that is unreachable", () => {
        const expecting = [dc("DC1"), dc("DC2", { agent: agent(60 * 40, { connected: false }) })];
        const domain = buildDomainHealth(expecting, { [ID.DC1]: health("DC1"), [ID.DC2]: silent("DC2") }, options);
        expect(types(domain)).toEqual(["dc-unreachable"]);
    });

    it("says of an agent that is not connected that it is not, and nothing its last report said", () => {
        const stale = local({ storage: { path: "/var/lib/samba", totalBytes: 100, freeBytes: 1 } });
        const dbcheck = { checkedAt: ago(5), receivedAt: ago(5), errors: 2 };
        const domain = buildDomainHealth(withAgent({ connected: false }), both({ local: stale, dbcheck }), options);
        expect(domain.issues).toEqual([
            expect.objectContaining({ type: "agent-offline", severity: "warning", dcId: ID.DC1, text: "DC1: its agent is not connected" }),
            // What the check found is still in the database.
            expect.objectContaining({ type: "dbcheck-errors" }),
        ]);
    });

    it("reports an agent that is not connected before the first measurement", () => {
        const domain = buildDomainHealth(withAgent({ connected: false }), { [ID.DC2]: health("DC2") }, options);
        expect(types(domain)).toEqual(["agent-offline"]);
    });

    it("ignores what a domain controller without an agent once reported", () => {
        const left = local({ storage: { path: "/var/lib/samba", totalBytes: 100, freeBytes: 1 } });
        expect(buildDomainHealth(listed, both({ local: left }), options).issues).toEqual([]);
    });

    it("reports a service of Samba that is configured and does not run", () => {
        const services = {
            configured: ["s3fs", "ldap", "kdc", "drepl"],
            running: [
                { name: "ldap_server", pids: [10] },
                { name: "kdc_server", pids: [11] },
            ],
        };
        expect(buildDomainHealth(withAgent(), both({ local: local({ services }) }), options).issues).toEqual([
            expect.objectContaining({
                type: "samba-service-down",
                severity: "error",
                text: "DC1: Samba's replication (drepl) service is not running",
            }),
        ]);
    });

    it("reports a process that is not running, and one that keeps starting", () => {
        const processes = [
            { name: "samba", state: "RUNNING", recentStarts: 4 },
            { name: "bind", state: "FATAL", exitStatus: 1 },
            { name: "other", state: "STARTING" },
        ];
        const domain = buildDomainHealth(withAgent(), both({ local: local({ processes }) }), options);
        expect(domain.issues.map((issue) => [issue.type, issue.severity, issue.text])).toEqual([
            ["process-restarting", "warning", "DC1: samba has started 4 times within the last hour"],
            ["process-not-running", "error", "DC1: bind is not running (fatal, exit status 1)"],
        ]);
    });

    it("reports storage that runs low, by how low", () => {
        const storage = (freeBytes: number) => local({ storage: { path: "/var/lib/samba", totalBytes: 100 * 2 ** 30, freeBytes } });
        const at = (free: number, over = {}) =>
            buildDomainHealth(withAgent(), both({ local: storage(free * 2 ** 30) }), { ...options, ...over }).issues;
        expect(at(20)).toEqual([]);
        expect(at(14.5)[0]).toMatchObject({
            type: "storage-low",
            severity: "warning",
            text: "DC1: 14 % of its storage is free (14.5 GB of 100 GB)",
        });
        expect(at(4)[0]).toMatchObject({ type: "storage-low", severity: "error" });
        expect(at(20, { storageWarningPercent: 25 })[0]).toMatchObject({ severity: "warning" });
    });

    it("holds the sysvol against the group policies of the same domain controller's directory", () => {
        const gpos = {
            collectedAt: ago(0),
            policies: [
                { guid: "31b2f340-016d-11d2-945f-00c04fb984f9", name: "Default Domain Policy", version: 5, changedAt: ago(600) },
                { guid: "6ac1786c-016f-11d2-945f-00c04fb984f9", name: "Default Domain Controllers Policy", version: 1, changedAt: ago(600) },
                { guid: "aaaaaaaa-0000-4000-8000-000000000001", name: "Printers", version: 2, changedAt: ago(600) },
                { guid: "aaaaaaaa-0000-4000-8000-000000000002", name: "Just edited", version: 9, changedAt: ago(5) },
            ],
        };
        const sysvol = (version: number) => ({
            path: "/var/lib/samba/sysvol",
            gpos: [
                { guid: "31B2F340-016D-11D2-945F-00C04FB984F9", version },
                { guid: "6ac1786c-016f-11d2-945f-00c04fb984f9", version: 1 },
                // A folder the directory knows no policy for.
                { guid: "ffffffff-0000-4000-8000-000000000009", version: 1 },
                { guid: "aaaaaaaa-0000-4000-8000-000000000002", version: 8 },
            ],
        });
        const domain = buildDomainHealth(withAgent(), both({ gpos, local: local({ sysvol: sysvol(3) }) }), options);
        expect(domain.issues).toEqual([
            expect.objectContaining({
                type: "sysvol-out-of-step",
                severity: "warning",
                text: "DC1: 2 of 4 group policies are not in step with its sysvol: Default Domain Policy (version 3, the directory says 5), Printers (not in the sysvol)",
            }),
        ]);
        // Without an agent there is no sysvol to hold against anything.
        expect(buildDomainHealth(listed, both({ gpos }), options).issues).toEqual([]);
    });

    it("puts the domain's own findings first", () => {
        const fsmo = { ...ALL_ON_DC1, rid: null };
        const view = { ...health("DC1").domain!, fsmo };
        const domain = buildDomainHealth(
            withAgent(),
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
                health_certificate_warning_days: "21",
                health_certificate_error_days: "7",
            }),
        ).toMatchObject({
            maxClockOffsetSeconds: 120,
            maxReplicationAgeMinutes: 30,
            maxDbcheckAgeHours: 48,
            certificateWarningDays: 21,
            certificateErrorDays: 7,
        });
    });

    it("falls back to the defaults for what is missing, zero or no number", () => {
        const defaults = {
            maxClockOffsetSeconds: 300,
            maxReplicationAgeMinutes: 60,
            maxDbcheckAgeHours: 36,
            storageWarningPercent: 15,
            storageErrorPercent: 5,
            certificateWarningDays: 14,
            certificateErrorDays: 3,
        };
        expect(domainHealthOptionsFromSettings({ health_max_clock_offset_seconds: "0", health_max_replication_age_minutes: "soon" })).toEqual(
            defaults,
        );
        expect(domainHealthOptionsFromSettings({})).toEqual(defaults);
    });
});

describe("formatBytes", () => {
    it("writes a size in the unit a reader would pick", () => {
        expect(formatBytes(512)).toBe("512 B");
        expect(formatBytes(3.4 * 2 ** 20)).toBe("3.4 MB");
        expect(formatBytes(120 * 2 ** 30)).toBe("120 GB");
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

describe("the DNS zones a domain controller serves", () => {
    const zone = (name: string, over: Record<string, unknown> = {}) => ({
        zone: name,
        nameServers: ["dc1.sadm.test", "dc2.sadm.test"],
        ok: true,
        serial: 40,
        refresh: 900,
        retry: 600,
        ...over,
    });
    const dns = (...zones: ReturnType<typeof zone>[]) => ({ collectedAt: ago(0), zones });

    it("says nothing while every zone is answered for", () => {
        const domain = buildDomainHealth(listed, both({ dns: dns(zone("sadm.test"), zone("_msdcs.sadm.test")) }), options);
        expect(domain.issues).toEqual([]);
    });

    it("names the zone a domain controller does not answer for, as an error", () => {
        const domain = buildDomainHealth(
            listed,
            both({ dns: dns(zone("sadm.test"), zone("Example.net", { ok: false, serial: null, detail: "refused" })) }),
            options,
        );
        expect(domain.issues).toEqual([
            {
                id: "dns-zone-not-served|DC1|example.net",
                type: "dns-zone-not-served",
                severity: "error",
                dc: "DC1",
                dcId: ID.DC1,
                text: "DC1: its DNS server does not answer for the zone Example.net: refused",
            },
        ]);
    });

    it("does not repeat a DNS server that is down once for every zone", () => {
        const services = [...SERVICES, service("DNS", 53, false, { check: "protocol", detail: "timed out" })];
        const down = dns(zone("sadm.test", { ok: false }), zone("_msdcs.sadm.test", { ok: false }));
        expect(types(buildDomainHealth(listed, both({ services, dns: down }), options))).toEqual(["service-down"]);
    });
});

describe("the name servers that are no domain controllers", () => {
    const server = (over: Record<string, unknown> = {}, zone: Record<string, unknown> = {}) => ({
        name: "ns2.sadm.test",
        address: "172.28.0.30",
        source: "ns" as const,
        collectedAt: ago(0),
        ok: true,
        zones: [{ zone: "sadm.test", ok: true, serial: 40, refresh: 900, retry: 600, referenceSerial: 40, ...zone }],
        ...over,
    });
    const issuesOf = (...servers: ReturnType<typeof server>[]) => buildDomainHealth(listed, both(), options, servers).issues;

    it("says nothing about one that is in step, and passes it on", () => {
        const domain = buildDomainHealth(listed, both(), options, [server()]);
        expect(domain.issues).toEqual([]);
        expect(domain.status).toBe("healthy");
        expect(domain.nameServers.map((ns) => ns.name)).toEqual(["ns2.sadm.test"]);
    });

    it("reports one a zone lists that does not answer, as an error", () => {
        expect(issuesOf(server({ ok: false, detail: "timed out", zones: [] }))).toEqual([
            {
                id: "dns-server-down||ns2.sadm.test",
                type: "dns-server-down",
                severity: "error",
                text: "Name server ns2.sadm.test: does not answer (timed out)",
            },
        ]);
    });

    it("reports one only the configuration names as a warning: no zone sends anybody there", () => {
        expect(issuesOf(server({ source: "config", ok: false, zones: [] }))[0]).toMatchObject({ severity: "warning" });
    });

    it("reports a zone it is listed for and does not answer for with authority", () => {
        expect(issuesOf(server({}, { ok: false, serial: null, detail: "not authoritative" }))).toEqual([
            {
                id: "dns-server-down||ns2.sadm.test/sadm.test",
                type: "dns-server-down",
                severity: "error",
                text: "Name server ns2.sadm.test: does not answer for the zone sadm.test: not authoritative",
            },
        ]);
    });

    it("leaves a secondary alone that is behind for less than a refresh and a retry", () => {
        // 900 s + 600 s is 25 minutes.
        expect(issuesOf(server({}, { serial: 39, outOfSyncSince: ago(24) }))).toEqual([]);
    });

    it("reports a secondary that has stayed behind for longer", () => {
        expect(issuesOf(server({}, { serial: 39, outOfSyncSince: ago(26) }))).toEqual([
            {
                id: "dns-secondary-behind||ns2.sadm.test/sadm.test",
                type: "dns-secondary-behind",
                severity: "warning",
                text: "Name server ns2.sadm.test: has not caught up with the zone sadm.test for 26 min (serial 39, the domain controllers serve 40)",
            },
        ]);
    });

    it("gives a secondary at least what BIND takes by itself, however short the zone's own times are", () => {
        // 300 s and 500 s are BIND's floors: 13 minutes and 20 seconds together.
        const quick = { serial: 39, refresh: 60, retry: 30 };
        expect(issuesOf(server({}, { ...quick, outOfSyncSince: ago(13) }))).toEqual([]);
        expect(types(buildDomainHealth(listed, both(), options, [server({}, { ...quick, outOfSyncSince: ago(14) })]))).toEqual([
            "dns-secondary-behind",
        ]);
    });

    it("measures the wait against when the server was asked, not against now", () => {
        // Asked 30 minutes ago, when it had been behind for 10: nothing has been seen since.
        expect(issuesOf(server({ collectedAt: ago(30) }, { serial: 39, outOfSyncSince: ago(40) }))).toEqual([]);
    });

    it("reports a secondary that is ahead, which transfers nothing", () => {
        const [issue] = issuesOf(server({}, { serial: 45, outOfSyncSince: ago(26) }));
        expect(issue).toMatchObject({ id: "dns-secondary-ahead||ns2.sadm.test/sadm.test", type: "dns-secondary-ahead", severity: "warning" });
        expect(issue.text).toContain("serial 45, the domain controllers serve 40");
    });

    it("says nothing without a serial number to compare with", () => {
        expect(issuesOf(server({}, { serial: 39, referenceSerial: null, outOfSyncSince: ago(60) }))).toEqual([]);
    });

    it("puts its findings with the domain's own, before any domain controller's", () => {
        const domain = buildDomainHealth(listed, both({ clockOffsetMs: -400_000 }), options, [server({ ok: false, zones: [] })]);
        expect(types(domain)).toEqual(["dns-server-down", "clock-offset"]);
        expect(domain.status).toBe("critical");
    });
});

describe("the DNS records the domain controllers register", () => {
    const records = (over: Record<string, unknown> = {}) => ({
        collectedAt: ago(0),
        controllers: [
            { dcId: ID.DC1, name: "DC1", expected: 29, missing: [] },
            { dcId: ID.DC2, name: "DC2", expected: 28, missing: [] },
        ],
        stale: [],
        ...over,
    });
    const withMissing = (...missing: { record: string; essential: boolean }[]) =>
        records({
            controllers: [
                { dcId: ID.DC1, name: "DC1", expected: 29, missing: [] },
                { dcId: ID.DC2, name: "DC2", expected: 28, missing },
            ],
        });
    const kpasswd = { record: "SRV _kpasswd._tcp.sadm.test (port 464)", essential: false };
    const alias = { record: "CNAME 2222._msdcs.sadm.test", essential: true };
    const site = { record: "SRV _ldap._tcp.site._sites.sadm.test (port 389)", essential: false };

    it("says nothing while every record is there", () => {
        expect(buildDomainHealth(listed, both({ dcRecords: records() }, { dcRecords: records() }), options).issues).toEqual([]);
    });

    it("reports a record a domain controller lacks, as its finding and a warning", () => {
        const domain = buildDomainHealth(listed, both({ dcRecords: withMissing(kpasswd) }, { dcRecords: withMissing(kpasswd) }), options);
        expect(domain.issues).toEqual([
            {
                id: "dc-records-missing|DC2|",
                type: "dc-records-missing",
                severity: "warning",
                dc: "DC2",
                dcId: ID.DC2,
                text: "DC2: 1 of its 28 DNS records is missing: SRV _kpasswd._tcp.sadm.test (port 464)",
            },
        ]);
        expect(domain.controllers.find((c) => c.name === "DC2")?.status).toBe("degraded");
        expect(domain.controllers.find((c) => c.name === "DC1")?.status).toBe("healthy");
    });

    it("makes it an error when what the domain controller is found by is missing, and names that first", () => {
        const dcRecords = withMissing(kpasswd, site, alias);
        const [issue] = buildDomainHealth(listed, both({ dcRecords }, { dcRecords }), options).issues;
        expect(issue).toMatchObject({ severity: "error", dc: "DC2" });
        expect(issue.text).toBe(
            "DC2: 3 of its 28 DNS records are missing: CNAME 2222._msdcs.sadm.test, SRV _kpasswd._tcp.sadm.test (port 464) and 1 more",
        );
    });

    it("says where a record is missing when the domain controllers do not agree", () => {
        const [issue] = buildDomainHealth(listed, both({ dcRecords: withMissing(kpasswd) }, { dcRecords: records() }), options).issues;
        expect(issue.text).toBe("DC2: 1 of its 28 DNS records is missing, in the directory of DC1: SRV _kpasswd._tcp.sadm.test (port 464)");
    });

    it("gives a domain controller that has just joined half an hour to register", () => {
        const dcRecords = withMissing(alias);
        const joined = (minutes: number) => [dc("DC1"), dc("DC2", { firstSeen: ago(minutes) })];
        expect(buildDomainHealth(joined(29), both({ dcRecords }, { dcRecords }), options).issues).toEqual([]);
        expect(types(buildDomainHealth(joined(31), both({ dcRecords }, { dcRecords }), options))).toEqual(["dc-records-missing"]);
    });

    it("does not add missing records to a domain controller that answers nothing", () => {
        const dcRecords = withMissing(alias);
        const domain = buildDomainHealth(listed, { [ID.DC1]: health("DC1", { dcRecords }), [ID.DC2]: silent("DC2") }, options);
        expect(types(domain)).toEqual(["dc-unreachable"]);
    });

    it("reports a host DNS still names as a domain controller, once however many records name it", () => {
        const stale = [
            { target: "dc9.sadm.test", type: "SRV", name: "_ldap._tcp.sadm.test" },
            { target: "dc9.sadm.test", type: "SRV", name: "_kerberos._tcp.sadm.test" },
            { target: "dc9.sadm.test", type: "CNAME", name: "9999._msdcs.sadm.test" },
            { target: "172.28.0.99", type: "A", name: "sadm.test" },
        ];
        const dcRecords = records({ stale });
        const domain = buildDomainHealth(listed, both({ dcRecords }, { dcRecords }), options);
        expect(domain.issues).toEqual([
            {
                id: "dns-stale-dc-record||172.28.0.99",
                type: "dns-stale-dc-record",
                severity: "warning",
                text: "DNS names 172.28.0.99 as a domain controller, and the directory lists none there: A sadm.test",
            },
            {
                id: "dns-stale-dc-record||dc9.sadm.test",
                type: "dns-stale-dc-record",
                severity: "warning",
                text: "DNS names dc9.sadm.test as a domain controller, and the directory lists none there: CNAME 9999._msdcs.sadm.test, SRV _kerberos._tcp.sadm.test and 1 more",
            },
        ]);
    });
});

const inDays = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

const certificate = (validTo: string, over: Partial<TlsCertificate> = {}): TlsCertificate => ({
    subject: "ldap.example.net",
    issuer: "R10",
    names: ["ldap.example.net"],
    validFrom: inDays(-60),
    validTo,
    ...over,
});

describe("the certificate of a domain controller", () => {
    it("says nothing while it has more than the warning threshold left", () => {
        const domain = buildDomainHealth(listed, { [ID.DC1]: health("DC1", { certificate: certificate(inDays(30)) }) }, options);
        expect(domain.issues.filter((issue) => issue.type === "certificate-expiring")).toEqual([]);
    });

    it("warns within the warning threshold, as the domain controller's finding", () => {
        const domain = buildDomainHealth(listed, { [ID.DC1]: health("DC1", { certificate: certificate(inDays(10)) }) }, options);
        expect(domain.issues.filter((issue) => issue.type === "certificate-expiring")).toEqual([
            {
                id: "certificate-expiring|DC1|",
                type: "certificate-expiring",
                severity: "warning",
                dc: "DC1",
                dcId: ID.DC1,
                text: "DC1: the certificate of its LDAPS expires in 10 d (R10)",
            },
        ]);
    });

    it("makes it an error within the error threshold, and once it has expired", () => {
        for (const validTo of [inDays(2), inDays(-1)]) {
            const domain = buildDomainHealth(listed, { [ID.DC1]: health("DC1", { certificate: certificate(validTo) }) }, options);
            expect(domain.issues.find((issue) => issue.type === "certificate-expiring")?.severity).toBe("error");
        }
        const expired = buildDomainHealth(listed, { [ID.DC1]: health("DC1", { certificate: certificate(inDays(-1)) }) }, options);
        expect(expired.issues.find((issue) => issue.type === "certificate-expiring")?.text).toBe(
            "DC1: the certificate of its LDAPS expired 1 d ago (R10)",
        );
    });

    it("follows the thresholds it is given", () => {
        const measured = { [ID.DC1]: health("DC1", { certificate: certificate(inDays(20)) }) };
        const domain = buildDomainHealth(listed, measured, { ...options, certificateWarningDays: 30, certificateErrorDays: 25 });
        expect(domain.issues.find((issue) => issue.type === "certificate-expiring")?.severity).toBe("error");
    });
});

describe("the names applications reach the directory under", () => {
    const url = (over: Partial<ServiceUrlHealth> = {}): ServiceUrlHealth => ({
        url: "ldaps://ldap.example.net",
        scheme: "ldaps",
        host: "ldap.example.net",
        port: 636,
        collectedAt: ago(0),
        ok: true,
        answeredBy: "DC1",
        tls: { ok: true, certificate: certificate(inDays(60)) },
        ...over,
    });
    const measured = { [ID.DC1]: health("DC1"), [ID.DC2]: health("DC2") };
    const findings = (...urls: ServiceUrlHealth[]) => buildDomainHealth(listed, measured, options, [], urls).issues;

    it("says nothing about one that answers with a good certificate, and passes it on", () => {
        const domain = buildDomainHealth(listed, measured, options, [], [url()]);
        expect(domain.issues).toEqual([]);
        expect(domain.serviceUrls.map((service) => service.url)).toEqual(["ldaps://ldap.example.net"]);
        expect(domain.status).toBe("healthy");
    });

    it("reports one that does not answer, as an error of the domain's", () => {
        expect(findings(url({ ok: false, detail: "connection refused", answeredBy: null, tls: null }))).toEqual([
            {
                id: "service-url-down||ldaps://ldap.example.net",
                type: "service-url-down",
                severity: "error",
                text: "ldaps://ldap.example.net: does not answer (connection refused)",
            },
        ]);
    });

    it("reports a certificate that is not good for the name, and not again as one that expires", () => {
        const bad = url({ tls: { ok: false, detail: "it is issued for dc1.home.lan", certificate: certificate(inDays(1)) } });
        expect(findings(bad)).toEqual([
            {
                id: "service-url-certificate||ldaps://ldap.example.net",
                type: "service-url-certificate",
                severity: "error",
                text: "ldaps://ldap.example.net: the certificate over LDAPS is not good for ldap.example.net: it is issued for dc1.home.lan",
            },
        ]);
    });

    it("says StartTLS for an ldap:// URL", () => {
        const plain = url({ url: "ldap://ldap.example.net", scheme: "ldap", port: 389, tls: { ok: false, detail: "StartTLS refused" } });
        expect(findings(plain)[0]?.text).toBe("ldap://ldap.example.net: the certificate after StartTLS is not good for ldap.example.net: StartTLS refused");
    });

    it("reports a certificate that expires soon, per URL", () => {
        const soon = findings(url({ tls: { ok: true, certificate: certificate(inDays(5)) } }), url({ url: "ldap://ldap.example.net", scheme: "ldap", port: 389, tls: { ok: true, certificate: certificate(inDays(5)) } }));
        expect(soon.map((issue) => [issue.id, issue.severity])).toEqual([
            ["certificate-expiring||ldap://ldap.example.net", "warning"],
            ["certificate-expiring||ldaps://ldap.example.net", "warning"],
        ]);
    });

    it("puts its findings with the domain's own, before any domain controller's", () => {
        const domain = buildDomainHealth(listed, { ...measured, [ID.DC2]: silent("DC2") }, options, [], [url({ ok: false, tls: null })]);
        expect(domain.issues.map((issue) => issue.type)).toEqual(["service-url-down", "dc-unreachable"]);
    });
});
