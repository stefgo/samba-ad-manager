import { beforeEach, describe, expect, it, vi } from "vitest";

// Both modules read the files of an installation the moment they are imported.
vi.mock("../core/Database.js", async () => {
    const { migratedMemoryDatabase } = await import("../testing/memoryDatabase.js");
    return { default: await migratedMemoryDatabase() };
});
vi.mock("../config/AppConfig.js", () => ({
    appConfig: { settings: { activity_level_overrides: "" }, jwtSecret: "test", security: { allow_self_signed_agent_certificates: false } },
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
