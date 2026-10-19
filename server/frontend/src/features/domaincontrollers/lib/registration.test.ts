import { describe, expect, it } from "vitest";
import type { DcAgent, DomainController } from "@sadm/shared";
import { awaitingRegistration, awaitsRegistration, registrationTokenState } from "./registration";

const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const LATER = "2026-10-19T12:20:00.000Z";
const EARLIER = "2026-10-19T11:50:00.000Z";

const agent: DcAgent = {
    connectionMode: "inbound",
    targetAddress: null,
    registeredAt: EARLIER,
    connected: true,
    lastSeen: EARLIER,
    hostname: "dc1",
    version: null,
    capabilities: [],
};

const dc = (id: string, over: Partial<DomainController> = {}): DomainController => ({
    id,
    name: id.toUpperCase(),
    dnsHostName: null,
    site: null,
    address: null,
    firstSeen: EARLIER,
    agent: null,
    agentRegistrationExpiresAt: null,
    ...over,
});

describe("registrationTokenState", () => {
    it("is open until the token expires, and expired after", () => {
        expect(registrationTokenState(dc("a", { agentRegistrationExpiresAt: LATER }), NOW)).toBe("open");
        expect(registrationTokenState(dc("a", { agentRegistrationExpiresAt: EARLIER }), NOW)).toBe("expired");
    });

    it("is none where no token was issued, or the one issued was used", () => {
        expect(registrationTokenState(dc("a"), NOW)).toBe("none");
    });
});

describe("awaitsRegistration", () => {
    it("is a domain controller without an agent and with an open token", () => {
        expect(awaitsRegistration(dc("a", { agentRegistrationExpiresAt: LATER }), NOW)).toBe(true);
    });

    it("is not one whose token ran out, nor one without a token", () => {
        expect(awaitsRegistration(dc("a", { agentRegistrationExpiresAt: EARLIER }), NOW)).toBe(false);
        expect(awaitsRegistration(dc("a"), NOW)).toBe(false);
    });

    // A token issued for an agent that is there registers it again; the agent is not missing.
    it("is not one that has an agent, token or not", () => {
        expect(awaitsRegistration(dc("a", { agent, agentRegistrationExpiresAt: LATER }), NOW)).toBe(false);
    });
});

describe("awaitingRegistration", () => {
    it("names the ones that wait", () => {
        const dcs = [dc("a", { agentRegistrationExpiresAt: LATER }), dc("b"), dc("c", { agent, agentRegistrationExpiresAt: LATER })];
        expect([...awaitingRegistration(dcs, NOW)]).toEqual(["a"]);
    });
});
