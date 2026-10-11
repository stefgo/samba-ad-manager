import { beforeEach, describe, expect, it, vi } from "vitest";

// Both modules read the files of an installation the moment they are imported.
vi.mock("../core/Database.js", async () => {
    const { migratedMemoryDatabase } = await import("../testing/memoryDatabase.js");
    return { default: await migratedMemoryDatabase() };
});
vi.mock("../config/AppConfig.js", () => ({
    appConfig: { settings: { activity_level_overrides: "" } },
    directoryConfig: { urls: [], bindDn: null, password: null, allowSelfSigned: false, timeoutMs: 15000 },
    readDirectoryCa: () => undefined,
}));

const { default: db } = await import("../core/Database.js");
const { DomainControllerService } = await import("./DomainControllerService.js");
const { DcHealthService } = await import("./DcHealthService.js");
const { ActivityService } = await import("./ActivityService.js");

const DC1 = { id: "11111111-1111-4111-8111-111111111111", name: "DC1", dnsHostName: "dc1.sadm.test", site: "HQ" };
const DC2 = { id: "22222222-2222-4222-8222-222222222222", name: "DC2", dnsHostName: "dc2.sadm.test", site: "HQ" };

const kinds = () => ActivityService.list(0).map((event) => `${event.kind} ${event.subject?.name}`);

beforeEach(() => {
    db.exec("DELETE FROM domain_controllers; DELETE FROM activity;");
});

describe("sync", () => {
    it("adds the domain controllers the directory lists, and records each", () => {
        DomainControllerService.sync([DC1, DC2]);
        expect(DomainControllerService.list().map((dc) => dc.name)).toEqual(["DC1", "DC2"]);
        expect(kinds().sort()).toEqual(["dc.discovered DC1", "dc.discovered DC2"]);
    });

    it("says nothing about a list that has not changed", () => {
        DomainControllerService.sync([DC1]);
        DomainControllerService.sync([DC1]);
        expect(kinds()).toEqual(["dc.discovered DC1"]);
    });

    it("takes over what the directory now says of one it knows", () => {
        DomainControllerService.sync([DC1]);
        DomainControllerService.sync([{ ...DC1, site: "Branch" }]);
        expect(DomainControllerService.get(DC1.id)?.site).toBe("Branch");
        expect(kinds()).toEqual(["dc.discovered DC1"]);
    });

    it("knows a domain controller by its id, however the directory spells it", () => {
        DomainControllerService.sync([DC1]);
        DomainControllerService.sync([{ ...DC1, id: DC1.id.toUpperCase() }]);
        expect(DomainControllerService.list()).toHaveLength(1);
    });

    it("forgets one the directory no longer lists, with what was known of it", () => {
        DomainControllerService.sync([DC1, DC2]);
        DcHealthService.storeMeasurement(DC2.id, { collectedAt: "2026-10-11T00:00:00.000Z", services: [], errors: [] });
        DomainControllerService.setAddress(DC2.id, "10.0.0.2");

        DomainControllerService.sync([DC1]);
        expect(DomainControllerService.list().map((dc) => dc.name)).toEqual(["DC1"]);
        expect(DcHealthService.get(DC2.id)).toBeNull();
        expect(kinds()).toContain("dc.removed DC2");
    });

    it("keeps the address that was set for one that stays", () => {
        DomainControllerService.sync([DC1]);
        DomainControllerService.setAddress(DC1.id, "10.0.0.1");
        DomainControllerService.sync([{ ...DC1, site: "Branch" }]);
        expect(DomainControllerService.get(DC1.id)?.address).toBe("10.0.0.1");
    });
});

describe("the report token", () => {
    beforeEach(() => DomainControllerService.sync([DC1, DC2]));

    it("names the domain controller it was issued for, and from when a report is expected", () => {
        const created = DomainControllerService.issueReportToken(DC1.id);
        expect(DomainControllerService.byReportToken(created!.token)?.id).toBe(DC1.id);
        expect(DomainControllerService.get(DC1.id)?.dbcheckSince).toBe(created!.dbcheckSince);
        expect(DomainControllerService.get(DC2.id)?.dbcheckSince).toBeNull();
    });

    it("is stored as its hash only", () => {
        const { token } = DomainControllerService.issueReportToken(DC1.id)!;
        const row = db.prepare("SELECT report_token_hash FROM domain_controllers WHERE id = ?").get(DC1.id) as {
            report_token_hash: string;
        };
        expect(row.report_token_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.report_token_hash).not.toContain(token);
    });

    it("stops working once another is issued in its place", () => {
        const first = DomainControllerService.issueReportToken(DC1.id)!;
        const second = DomainControllerService.issueReportToken(DC1.id)!;
        expect(DomainControllerService.byReportToken(first.token)).toBeNull();
        expect(DomainControllerService.byReportToken(second.token)?.id).toBe(DC1.id);
    });

    it("is nobody's when it was never issued", () => {
        expect(DomainControllerService.byReportToken("made-up")).toBeNull();
        expect(DomainControllerService.byReportToken("")).toBeNull();
    });

    it("takes the last reported check with it when it is removed", () => {
        const { token } = DomainControllerService.issueReportToken(DC1.id)!;
        DcHealthService.storeMeasurement(DC1.id, { collectedAt: "2026-10-11T00:00:00.000Z", services: [], errors: [] });
        DcHealthService.storeDbcheck({ dcId: DC1.id, checkedAt: "2026-10-11T00:00:00Z", errors: 2 });
        expect(DcHealthService.get(DC1.id)?.dbcheck?.errors).toBe(2);

        expect(DomainControllerService.revokeReportToken(DC1.id)).toBe(true);
        expect(DomainControllerService.byReportToken(token)).toBeNull();
        expect(DomainControllerService.get(DC1.id)?.dbcheckSince).toBeNull();
        expect(DcHealthService.get(DC1.id)?.dbcheck).toBeNull();
    });

    it("has nothing to issue or remove for a domain controller that does not exist", () => {
        expect(DomainControllerService.issueReportToken("nope")).toBeNull();
        expect(DomainControllerService.revokeReportToken("nope")).toBe(false);
    });
});
