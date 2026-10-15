import { describe, expect, it } from "vitest";
import type { ReplicationSyncReport } from "@sadm/shared";
import { replicationSyncActivity } from "./replicationSync.js";

const DC2 = "22222222-2222-4222-8222-222222222222";
const DC3 = "33333333-3333-4333-8333-333333333333";
const names: Record<string, string> = { [DC2]: "DC2" };
const nameOf = (id: string) => names[id] ?? null;

const report = (over: Partial<ReplicationSyncReport>): ReplicationSyncReport => ({ syncedAt: "2026-01-01T00:00:00.000Z", links: [], ...over });
const link = (partner: string, namingContext: string, error: string | null = null) => ({
    partner,
    partnerAddress: `${partner}._msdcs.sadm.test`,
    namingContext,
    error,
});

describe("replicationSyncActivity", () => {
    it("is info when every link replicated", () => {
        const activity = replicationSyncActivity(report({ links: [link(DC2, "DC=sadm,DC=test"), link(DC2, "CN=Configuration,DC=sadm,DC=test")] }), nameOf);
        expect(activity).toEqual({ level: "info", data: { links: 2, failed: 0, failures: [] } });
    });

    it("is a warning naming each failed link, by the partner's name where the list knows it", () => {
        const activity = replicationSyncActivity(
            report({
                links: [link(DC2.toUpperCase(), "DC=sadm,DC=test", "WERR_X"), link(DC3, "DC=sadm,DC=test", "WERR_Y"), link(DC2, "CN=Schema")],
            }),
            nameOf,
        );
        expect(activity.level).toBe("warning");
        expect(activity.data.links).toBe(3);
        expect(activity.data.failed).toBe(2);
        expect(activity.data.failures.map((f) => f.partner)).toEqual(["DC2", `${DC3}._msdcs.sadm.test`]);
        expect(activity.data.error).toBe(`from DC2, DC=sadm,DC=test: WERR_X; from ${DC3}._msdcs.sadm.test, DC=sadm,DC=test: WERR_Y`);
    });

    it("is an error with the reason when nothing could be asked", () => {
        const activity = replicationSyncActivity(report({ error: "NT_STATUS_ACCESS_DENIED" }), nameOf);
        expect(activity).toEqual({ level: "error", data: { links: 0, failed: 0, failures: [], error: "NT_STATUS_ACCESS_DENIED" } });
    });

    it("keeps the detail short", () => {
        const links = Array.from({ length: 100 }, () => link(DC2, "DC=sadm,DC=test", "x".repeat(100)));
        expect(replicationSyncActivity(report({ links }), nameOf).data.error).toHaveLength(2000);
    });
});
