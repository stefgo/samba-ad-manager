import { describe, expect, it, vi } from "vitest";
import { emptyHistory, withAppeared } from "../services/issueHistory.js";
import type { TrackedFinding, TrackedIncident } from "../services/domainIncidentTracker.js";

vi.mock("../core/Database.js", async () => {
    const { migratedMemoryDatabase } = await import("../testing/memoryDatabase.js");
    return { default: await migratedMemoryDatabase() };
});

const { DomainIncidentRepository } = await import("./DomainIncidentRepository.js");

const finding = (id: string, over: Partial<TrackedFinding> = {}): TrackedFinding => ({
    id,
    type: "storage-low",
    severity: "error",
    worstSeverity: "error",
    text: `${id} is wrong`,
    state: "reported",
    since: "2026-10-15T12:00:00.000Z",
    lastSeenAt: "2026-10-15T12:06:00.000Z",
    goneSince: null,
    reportedAt: "2026-10-15T12:05:00.000Z",
    reportedSeverity: "warning",
    escalatingSince: "2026-10-15T12:06:00.000Z",
    gaps: 2,
    history: withAppeared(emptyHistory(), "2026-10-15T12:00:00.000Z", "warning", `${id} is wrong`),
    ...over,
});

const incident = (key: string, over: Partial<TrackedIncident> = {}): TrackedIncident => ({
    key,
    dc: "DC1",
    dcId: key,
    since: "2026-10-15T12:00:00.000Z",
    lastSeenAt: "2026-10-15T12:06:00.000Z",
    openedAt: "2026-10-15T12:05:00.000Z",
    correlationId: `c-${key}`,
    findings: [finding("x")],
    ...over,
});

describe("DomainIncidentRepository", () => {
    it("keeps the reported incidents with their reported findings, and nothing of what is only memory", () => {
        DomainIncidentRepository.replaceOpen([
            incident("a", { findings: [finding("x"), finding("y", { state: "pending", reportedAt: null, reportedSeverity: null })] }),
            incident("b", { openedAt: null, correlationId: null }),
        ]);
        expect(DomainIncidentRepository.findOpen()).toEqual([
            incident("a", { findings: [finding("x", { gaps: 0, history: emptyHistory() })] }),
        ]);
    });

    it("forgets what is no longer handed to it", () => {
        DomainIncidentRepository.replaceOpen([incident("a"), incident("b")]);
        DomainIncidentRepository.replaceOpen([incident("b", { findings: [] })]);
        expect(DomainIncidentRepository.findOpen()).toEqual([incident("b", { findings: [] })]);
    });
});
