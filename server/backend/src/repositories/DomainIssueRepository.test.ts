import { describe, expect, it, vi } from "vitest";
import type { TrackedIssue } from "../services/domainIssueTracker.js";

vi.mock("../core/Database.js", async () => {
    const { migratedMemoryDatabase } = await import("../testing/memoryDatabase.js");
    return { default: await migratedMemoryDatabase() };
});

const { DomainIssueRepository } = await import("./DomainIssueRepository.js");

const row = (id: string, over: Partial<TrackedIssue> = {}): TrackedIssue => ({
    id,
    type: "storage-low",
    severity: "warning",
    dc: "DC1",
    dcId: "a",
    text: `${id} is wrong`,
    state: "pending",
    seenSince: "2026-10-15T12:00:00.000Z",
    lastSeenAt: "2026-10-15T12:01:00.000Z",
    openedAt: null,
    correlationId: null,
    escalatingSince: null,
    ...over,
});

describe("DomainIssueRepository", () => {
    it("keeps a pending finding without a correlation id, and writes it over once reported", () => {
        DomainIssueRepository.apply([row("x"), row("y")], []);
        expect(DomainIssueRepository.findAll()).toEqual([row("x"), row("y")]);

        const opened = row("x", { state: "open", openedAt: "2026-10-15T12:05:00.000Z", correlationId: "c1" });
        DomainIssueRepository.apply([opened], ["y"]);
        expect(DomainIssueRepository.findAll()).toEqual([opened]);
    });
});
