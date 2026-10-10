import { describe, expect, it, vi } from "vitest";
import { createDashboardMessageReader } from "./dashboardMessages";

const seen = JSON.stringify({ type: "ACTIVITY_SEEN", payload: { ids: ["e1"] } });

describe("createDashboardMessageReader", () => {
    it("returns a message that matches the contract", () => {
        const report = vi.fn();
        const read = createDashboardMessageReader(report);
        expect(read(seen)).toEqual({ type: "ACTIVITY_SEEN", payload: { ids: ["e1"] } });
        expect(report).not.toHaveBeenCalled();
    });

    it("drops a message whose payload has the wrong shape", () => {
        const report = vi.fn();
        const read = createDashboardMessageReader(report);
        expect(read(JSON.stringify({ type: "ACTIVITY_SEEN", payload: { ids: "e1" } }))).toBeNull();
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0][0]).toContain("ACTIVITY_SEEN");
    });

    it("drops a type it does not know and names it", () => {
        const report = vi.fn();
        const read = createDashboardMessageReader(report);
        expect(read(JSON.stringify({ type: "FROM_A_NEWER_SERVER", payload: 1 }))).toBeNull();
        expect(report.mock.calls[0][0]).toContain("FROM_A_NEWER_SERVER");
    });

    it("drops what is not JSON", () => {
        const report = vi.fn();
        const read = createDashboardMessageReader(report);
        expect(read("{")).toBeNull();
        expect(report).toHaveBeenCalledTimes(1);
    });

    it("drops JSON that is not a message at all", () => {
        const report = vi.fn();
        const read = createDashboardMessageReader(report);
        expect(read("null")).toBeNull();
        expect(read('"CLIENTS_UPDATE"')).toBeNull();
        // Both are "(no type)", so the second is not reported again.
        expect(report).toHaveBeenCalledTimes(1);
    });

    // A broken message of one type tends to arrive again and again.
    it("reports a broken type once, and another type on its own", () => {
        const report = vi.fn();
        const read = createDashboardMessageReader(report);
        const broken = JSON.stringify({ type: "CLIENTS_UPDATE", payload: {} });
        read(broken);
        read(broken);
        read(broken);
        expect(report).toHaveBeenCalledTimes(1);

        read(JSON.stringify({ type: "ACTIVITY_SEEN", payload: {} }));
        expect(report).toHaveBeenCalledTimes(2);
    });

    it("keeps reading valid messages of a type after a broken one", () => {
        const read = createDashboardMessageReader(vi.fn());
        expect(read(JSON.stringify({ type: "ACTIVITY_SEEN" }))).toBeNull();
        expect(read(seen)).not.toBeNull();
    });
});
