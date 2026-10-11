import { describe, expect, it } from "vitest";
import type { ControllerHealth, DcHealth, DcService, DomainIssue } from "@sadm/shared";
import { clockOffsetLabel, controllerSummary, issueText, replicationSummary, serviceNote } from "./health";

const issue = (over: Partial<DomainIssue> = {}): DomainIssue => ({
    id: "service-down|DC1|389",
    type: "service-down",
    severity: "warning",
    dc: "DC1",
    text: "DC1: LDAP (port 389) does not answer",
    ...over,
});

const controller = (over: Partial<ControllerHealth> = {}): ControllerHealth => ({
    id: "11111111-1111-4111-8111-111111111111",
    name: "DC1",
    dnsHostName: null,
    site: null,
    health: null,
    roles: [],
    isGlobalCatalog: null,
    status: "healthy",
    issues: [],
    ...over,
});

const link = (partner: string, lastSuccess: string | null, consecutiveFailures = 0) => ({
    namingContext: "DC=sadm,DC=test",
    partner,
    lastAttempt: lastSuccess,
    lastSuccess,
    consecutiveFailures,
    resultCode: 0,
});

describe("issueText", () => {
    it("drops the name the place already shows", () => {
        expect(issueText(issue())).toBe("LDAP (port 389) does not answer");
    });

    it("leaves a finding about the domain as it is", () => {
        const text = "RID master: no domain controller holds the role";
        expect(issueText(issue({ dc: undefined, text }))).toBe(text);
    });
});

describe("controllerSummary", () => {
    it("says that there is nothing, or nothing known", () => {
        expect(controllerSummary(controller())).toBe("No findings");
        expect(controllerSummary(controller({ status: "unknown" }))).toBe("Not measured yet");
    });

    it("leads with an error and counts the rest", () => {
        const issues = [issue(), issue({ severity: "error", text: "DC1: does not answer on any of its services" }), issue()];
        expect(controllerSummary(controller({ issues }))).toBe("does not answer on any of its services (+2 more)");
    });
});

describe("replicationSummary", () => {
    it("is nothing while replication was not read", () => {
        expect(replicationSummary(null)).toBeNull();
        expect(replicationSummary({ replication: null } as unknown as DcHealth)).toBeNull();
    });

    it("counts partners, not links, and finds the oldest success", () => {
        const inbound = [
            link("DC2", "2026-10-10T10:00:00.000Z"),
            link("DC2", "2026-10-10T09:00:00.000Z", 2),
            link("DC3", "2026-10-10T11:00:00.000Z"),
        ];
        const health = { replication: { collectedAt: "", inbound, outbound: [] } } as unknown as DcHealth;
        expect(replicationSummary(health)).toEqual({
            partners: 2,
            failing: 1,
            oldestSuccess: "2026-10-10T09:00:00.000Z",
        });
    });
});

describe("clockOffsetLabel", () => {
    it("calls less than a second in sync", () => {
        expect(clockOffsetLabel(-400)).toBe("in sync");
    });

    it("says which way and how far", () => {
        expect(clockOffsetLabel(12_000)).toBe("+12 s");
        expect(clockOffsetLabel(-360_000)).toBe("−6 min");
    });

    it("is a dash without a value", () => {
        expect(clockOffsetLabel(null)).toBe("–");
    });
});

describe("serviceNote", () => {
    const service = (over: Partial<DcService> = {}): DcService => ({ name: "Kerberos", port: 88, check: "protocol", ok: true, ...over });

    it("says how a service was found to be there, and how fast", () => {
        expect(serviceNote(service({ latencyMs: 12.4 }))).toBe("answers · 12 ms");
        expect(serviceNote(service({ check: "connect", latencyMs: 3 }))).toBe("port open · 3 ms");
        expect(serviceNote(service())).toBe("answers");
    });

    it("says why a service is not there", () => {
        expect(serviceNote(service({ ok: false, detail: "timed out" }))).toBe("timed out");
        expect(serviceNote(service({ ok: false }))).toBe("does not answer");
    });
});
