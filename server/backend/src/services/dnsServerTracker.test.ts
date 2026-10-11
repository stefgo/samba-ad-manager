import { describe, expect, it } from "vitest";
import { highestSerial, type DnsServerHealth } from "@sadm/shared";
import { nameServersToAsk, referenceSerials, trackOutOfSync, type ZoneAnswer } from "./dnsServerTracker.js";

const T0 = "2026-10-11T12:00:00.000Z";
const T1 = "2026-10-11T12:05:00.000Z";

const answer = (serial: number | null, over: Partial<ZoneAnswer> = {}): ZoneAnswer => ({
    zone: "sadm.test",
    ok: serial !== null,
    serial,
    refresh: 900,
    retry: 600,
    ...over,
});

const server = (zones: DnsServerHealth["zones"]): DnsServerHealth => ({
    name: "ns2.sadm.test",
    address: "172.28.0.30",
    source: "ns",
    collectedAt: T0,
    ok: true,
    zones,
});

const refs = (serial: number) => new Map([["sadm.test", serial]]);

describe("trackOutOfSync", () => {
    it("has nothing to say about a server that is in step", () => {
        expect(trackOutOfSync(null, [answer(40)], refs(40), T0)).toEqual([{ ...answer(40), referenceSerial: 40, outOfSyncSince: null }]);
    });

    it("starts the wait when a difference is first seen", () => {
        expect(trackOutOfSync(null, [answer(39)], refs(40), T0)[0]).toMatchObject({ referenceSerial: 40, outOfSyncSince: T0 });
    });

    it("keeps the wait while the server's own serial number does not move", () => {
        const before = server(trackOutOfSync(null, [answer(39)], refs(40), T0));
        // The domain controllers have gone further meanwhile; that changes nothing about how long this one is stuck.
        expect(trackOutOfSync(before, [answer(39)], refs(42), T1)[0]).toMatchObject({ referenceSerial: 42, outOfSyncSince: T0 });
    });

    it("starts the wait again when the server has moved and is still not there", () => {
        const before = server(trackOutOfSync(null, [answer(39)], refs(40), T0));
        expect(trackOutOfSync(before, [answer(41)], refs(43), T1)[0]).toMatchObject({ outOfSyncSince: T1 });
    });

    it("ends the wait when the server has caught up", () => {
        const before = server(trackOutOfSync(null, [answer(39)], refs(40), T0));
        expect(trackOutOfSync(before, [answer(40)], refs(40), T1)[0].outOfSyncSince).toBeNull();
    });

    it("waits for a server that is ahead just the same", () => {
        expect(trackOutOfSync(null, [answer(45)], refs(40), T0)[0].outOfSyncSince).toBe(T0);
    });

    it("does not compare what did not answer, or what no domain controller serves", () => {
        expect(trackOutOfSync(null, [answer(null)], refs(40), T0)[0]).toMatchObject({ referenceSerial: 40, outOfSyncSince: null });
        expect(trackOutOfSync(null, [answer(39)], new Map(), T0)[0]).toMatchObject({ referenceSerial: null, outOfSyncSince: null });
    });

    it("finds a zone again whatever case its name is written in", () => {
        const before = server(trackOutOfSync(null, [answer(39, { zone: "SADM.test" })], refs(40), T0));
        expect(trackOutOfSync(before, [answer(39)], refs(40), T1)[0].outOfSyncSince).toBe(T0);
    });
});

describe("referenceSerials", () => {
    it("takes the highest serial number a domain controller serves for each zone", () => {
        const dc1 = { zones: [{ zone: "sadm.test", ok: true, serial: 40 }, { zone: "_msdcs.sadm.test", ok: true, serial: 7 }] };
        const dc2 = { zones: [{ zone: "SADM.TEST", ok: true, serial: 41 }, { zone: "_msdcs.sadm.test", ok: false, serial: null }] };
        expect([...referenceSerials([dc1, dc2], highestSerial)]).toEqual([
            ["sadm.test", 41],
            ["_msdcs.sadm.test", 7],
        ]);
    });
});

describe("nameServersToAsk", () => {
    const zones = [
        { zone: "sadm.test", nameServers: ["dc1.sadm.test", "DC2.sadm.test.", "ns2.sadm.test"] },
        { zone: "_msdcs.sadm.test", nameServers: ["dc1.sadm.test", "dc2.sadm.test"] },
        { zone: "2.0.192.in-addr.arpa", nameServers: ["dc1.sadm.test", "NS2.sadm.test", "ns3.example.net"] },
    ];
    const dcs = ["DC1.sadm.test", "dc2.sadm.test", null];

    it("asks every listed server that is no domain controller about the zones that list it", () => {
        expect(nameServersToAsk(zones, dcs, [])).toEqual([
            { name: "ns2.sadm.test", source: "ns", zones: ["2.0.192.in-addr.arpa", "sadm.test"] },
            { name: "ns3.example.net", source: "ns", zones: ["2.0.192.in-addr.arpa"] },
        ]);
    });

    it("asks a server only the configuration names about every zone", () => {
        expect(nameServersToAsk(zones, dcs, ["192.0.2.53"])).toContainEqual({
            name: "192.0.2.53",
            source: "config",
            zones: ["2.0.192.in-addr.arpa", "_msdcs.sadm.test", "sadm.test"],
        });
    });

    it("does not ask a server twice that is listed and configured, nor a domain controller at all", () => {
        expect(nameServersToAsk(zones, dcs, ["NS2.sadm.test", "dc1.sadm.test"]).map((ns) => ns.name)).toEqual([
            "ns2.sadm.test",
            "ns3.example.net",
        ]);
    });

    it("has nobody to ask in a domain whose zones list only domain controllers", () => {
        expect(nameServersToAsk([zones[1]], dcs, [])).toEqual([]);
    });
});
