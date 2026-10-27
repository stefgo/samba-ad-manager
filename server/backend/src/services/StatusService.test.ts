import { StatusReportSchema, type DomainHealth, type DomainIssue } from "@sadm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const current = vi.fn<(now?: number) => DomainHealth>();
const issueStates = vi.fn();

// DomainEventService reaches the database and config.yaml when it is imported.
vi.mock("./DomainEventService.js", () => ({
    DomainEventService: { current: (now?: number) => current(now), issueStates: () => issueStates() },
}));

const { StatusService } = await import("./StatusService.js");

const NOW = Date.parse("2026-10-27T10:00:00.000Z");

const issue = (id: string, severity: DomainIssue["severity"], text: string): DomainIssue => ({
    id,
    type: id.split("|")[0] as DomainIssue["type"],
    severity,
    text,
});

function domain(overrides: Partial<DomainHealth> = {}): DomainHealth {
    return {
        status: "healthy",
        dnsName: "sadm.test",
        dn: "DC=sadm,DC=test",
        domainLevel: null,
        forestLevel: null,
        controllers: [],
        fsmo: {} as DomainHealth["fsmo"],
        counts: { users: 10, groups: 4, computers: 2 },
        nameServers: [],
        serviceUrls: [],
        issues: [],
        ...overrides,
    };
}

beforeEach(() => {
    current.mockReset();
    issueStates.mockReset().mockReturnValue([]);
});

describe("StatusService.report", () => {
    it("says what the dashboard says, in the contract every manager answers with", () => {
        current.mockReturnValue(
            domain({
                status: "critical",
                issues: [
                    issue("dc-unreachable|DC2|", "error", "DC2: Does not answer"),
                    issue("clock-offset|DC1|", "warning", "DC1: Clock is 7 min off"),
                ],
            }),
        );
        issueStates.mockReturnValue([
            { id: "dc-unreachable|DC2|", state: "open", since: "2026-10-27T09:00:00.000Z", reportAt: null, openedAt: null },
        ]);

        const report = StatusService.report(NOW);

        expect(StatusReportSchema.parse(report)).toEqual(report);
        expect(current).toHaveBeenCalledWith(NOW);
        expect(report).toMatchObject({
            app: "sadm",
            status: "critical",
            checkedAt: "2026-10-27T10:00:00.000Z",
            counts: { error: 1, warning: 1 },
        });
        expect(report.findings).toEqual([
            { id: "dc-unreachable|DC2|", type: "dc-unreachable", severity: "error", text: "DC2: Does not answer", since: "2026-10-27T09:00:00.000Z" },
            { id: "clock-offset|DC1|", type: "clock-offset", severity: "warning", text: "DC1: Clock is 7 min off", since: null },
        ]);
    });

    it("sums up the domain as the dashboard's cards do", () => {
        const measured = {} as NonNullable<DomainHealth["controllers"][number]["health"]>;
        current.mockReturnValue(
            domain({
                controllers: [
                    { health: measured, issues: [] },
                    { health: measured, issues: [issue("dc-unreachable|DC2|", "error", "x")] },
                    { health: null, issues: [] },
                ] as unknown as DomainHealth["controllers"],
            }),
        );

        expect(StatusService.report(NOW).summary).toEqual({
            domain: "sadm.test",
            controllers: { answering: 1, total: 3 },
            objects: { users: 10, groups: 4, computers: 2 },
        });
    });

    it("has nothing to report before the first measurement, and says so", () => {
        current.mockReturnValue(domain({ status: "unknown", dnsName: null, counts: null }));

        const report = StatusService.report(NOW);

        expect(report.status).toBe("unknown");
        expect(report.findings).toEqual([]);
        expect(report.counts).toEqual({ error: 0, warning: 0 });
    });
});
