import { describe, expect, it } from "vitest";
import { UpdateDomainControllerSchema } from "@sadm/shared";
import { addressDraftFrom, addressFieldOf, addressInputFrom, reachedAt } from "./domainControllerForm";

describe("the address form", () => {
    it("starts from the address that is set, or empty", () => {
        expect(addressDraftFrom({ address: "10.0.0.5" })).toEqual({ address: "10.0.0.5" });
        expect(addressDraftFrom({ address: null })).toEqual({ address: "" });
    });

    it("sends the address trimmed, and null for an emptied field", () => {
        expect(addressInputFrom({ address: " dc1.example.net " })).toEqual({ address: "dc1.example.net" });
        expect(addressInputFrom({ address: "   " })).toEqual({ address: null });
    });

    it("sends what the request schema takes", () => {
        expect(UpdateDomainControllerSchema.safeParse(addressInputFrom({ address: "10.0.0.5" })).success).toBe(true);
        expect(UpdateDomainControllerSchema.safeParse(addressInputFrom({ address: "fd00::21" })).success).toBe(true);
        expect(UpdateDomainControllerSchema.safeParse(addressInputFrom({ address: "" })).success).toBe(true);
    });

    it("is refused with a scheme, a port or a path", () => {
        for (const address of ["ldaps://dc1.example.net", "dc1.example.net:636", "dc1.example.net/x", "dc1 example"]) {
            const parsed = UpdateDomainControllerSchema.safeParse(addressInputFrom({ address }));
            expect(parsed.success, address).toBe(false);
            expect(addressFieldOf(parsed.error!.issues[0].path)).toBe("address");
        }
    });
});

describe("reachedAt", () => {
    it("is the address that was set, else the name in the directory", () => {
        expect(reachedAt({ address: "10.0.0.5", dnsHostName: "dc1.sadm.test" })).toBe("10.0.0.5");
        expect(reachedAt({ address: null, dnsHostName: "dc1.sadm.test" })).toBe("dc1.sadm.test");
    });

    it("says so when there is neither", () => {
        expect(reachedAt({ address: null, dnsHostName: null })).toMatch(/names no host/);
    });
});
