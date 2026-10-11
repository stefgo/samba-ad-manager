import { describe, expect, it } from "vitest";
import { buildDomainHealth, type DcHealth, type DnsServerHealth } from "@sadm/shared";
import { worstZoneState, zoneServers } from "./zoneServers";

const NOW = Date.parse("2026-10-11T12:00:00.000Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const ID = { DC1: "11111111-1111-4111-8111-111111111111", DC2: "22222222-2222-4222-8222-222222222222" };
const listed = [
    { id: ID.DC1, name: "DC1" },
    { id: ID.DC2, name: "DC2" },
];

const health = (name: "DC1" | "DC2", serial: number | null, detail?: string): DcHealth => ({
    dcId: ID[name],
    collectedAt: ago(0),
    services: [{ name: "DNS", port: 53, check: "protocol", ok: true }],
    dns: {
        collectedAt: ago(0),
        zones: [{ zone: "sadm.test", nameServers: [], ok: serial !== null, serial, refresh: 900, retry: 600, detail }],
    },
    errors: [],
});

const ns2 = (zone: Partial<DnsServerHealth["zones"][number]> = {}, over: Partial<DnsServerHealth> = {}): DnsServerHealth => ({
    name: "ns2.sadm.test",
    address: "172.28.0.30",
    source: "ns",
    collectedAt: ago(0),
    ok: true,
    zones: [{ zone: "sadm.test", ok: true, serial: 40, refresh: 900, retry: 600, referenceSerial: 40, ...zone }],
    ...over,
});

const servers = (dc1: number | null, dc2: number | null, ...nameServers: DnsServerHealth[]) =>
    zoneServers(
        buildDomainHealth(listed, { [ID.DC1]: health("DC1", dc1, "refused"), [ID.DC2]: health("DC2", dc2) }, { now: NOW }, nameServers),
        { name: "SADM.test", nameServers: ["dc1.sadm.test", "NS2.sadm.test."] },
    );

const states = (list: ReturnType<typeof servers>) => list.map((server) => `${server.name} ${server.state}`);

describe("zoneServers", () => {
    it("lists the domain controllers first, then the secondaries, all in step", () => {
        const list = servers(40, 40, ns2());
        expect(states(list)).toEqual(["DC1 in-step", "DC2 in-step", "ns2.sadm.test in-step"]);
        expect(list[0]).toMatchObject({ kind: "domain-controller", dcId: ID.DC1, serial: 40 });
        expect(list[2]).toMatchObject({ kind: "secondary", serial: 40 });
    });

    it("shows a domain controller that has not replicated a change yet as catching up", () => {
        expect(states(servers(41, 40))).toEqual(["DC1 in-step", "DC2 catching-up"]);
    });

    it("shows a domain controller that does not answer for the zone, with why", () => {
        expect(servers(null, 40)[0]).toMatchObject({ state: "down", detail: "refused" });
    });

    it("tells a secondary that is waiting from one that has stayed behind", () => {
        expect(states(servers(40, 40, ns2({ serial: 39, outOfSyncSince: ago(5) })))[2]).toBe("ns2.sadm.test catching-up");
        expect(states(servers(40, 40, ns2({ serial: 39, outOfSyncSince: ago(30) })))[2]).toBe("ns2.sadm.test behind");
        expect(states(servers(40, 40, ns2({ serial: 45, outOfSyncSince: ago(30) })))[2]).toBe("ns2.sadm.test ahead");
    });

    it("shows a secondary that does not answer, for the zone or at all", () => {
        expect(servers(40, 40, ns2({ ok: false, serial: null, detail: "not authoritative" }))[2]).toMatchObject({
            state: "down",
            detail: "not authoritative",
        });
        expect(servers(40, 40, ns2({}, { ok: false, detail: "timed out", zones: [] }))[2]).toMatchObject({
            state: "down",
            detail: "timed out",
        });
    });

    it("leaves out a secondary that answers and was not asked about this zone", () => {
        expect(states(servers(40, 40, ns2({ zone: "example.net" })))).toEqual(["DC1 in-step", "DC2 in-step"]);
    });

    it("leaves out a secondary that does not answer at all, in a zone that does not list it", () => {
        const domain = buildDomainHealth(listed, { [ID.DC1]: health("DC1", 40) }, { now: NOW }, [ns2({}, { ok: false, zones: [] })]);
        expect(zoneServers(domain, { name: "sadm.test", nameServers: ["dc1.sadm.test"] }).map((server) => server.name)).toEqual(["DC1"]);
    });

    it("has nothing before the zones were first asked for", () => {
        expect(zoneServers(buildDomainHealth(listed, {}, { now: NOW }), { name: "sadm.test", nameServers: [] })).toEqual([]);
    });
});

describe("worstZoneState", () => {
    it("is what one badge says for all servers", () => {
        expect(worstZoneState(servers(40, 40, ns2()))).toBe("in-step");
        expect(worstZoneState(servers(41, 40, ns2({ serial: 39, outOfSyncSince: ago(30) })))).toBe("behind");
        expect(worstZoneState(servers(null, 40, ns2({ serial: 39, outOfSyncSince: ago(30) })))).toBe("down");
        expect(worstZoneState([])).toBeNull();
    });
});
