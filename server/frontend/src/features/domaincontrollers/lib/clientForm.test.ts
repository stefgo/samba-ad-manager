import { describe, expect, it } from "vitest";
import { UpdateClientSchema } from "@sadm/shared";
import { checkDraft, isSameDraft } from "../../../lib/entityForm";
import {
    clientFieldOf,
    clientInputFrom,
    clientRules,
    significantClientDraft,
    storedClientDraft,
    type ClientDraft,
} from "./clientForm";

const draft = (changes: Partial<ClientDraft> = {}): ClientDraft => ({
    displayName: "",
    site: "",
    targetAddress: "",
    restrictIp: false,
    allowedIp: "",
    ...changes,
});

const NOTHING = { inboundAllowedIp: null, outboundTargetAddress: null };

const check = (d: ClientDraft, outbound: boolean, stored = NOTHING as Parameters<typeof clientInputFrom>[2]) =>
    checkDraft(
        {
            schema: UpdateClientSchema,
            toInput: (x: ClientDraft) => clientInputFrom(x, outbound, stored),
            fieldOf: clientFieldOf,
            rules: (x) => clientRules(x, outbound),
        },
        d,
    );

describe("clientInputFrom", () => {
    it("sends name and site alone when no address changed", () => {
        expect(clientInputFrom(draft({ displayName: " lb1 ", site: " dc-berlin " }), false, NOTHING)).toEqual({
            displayName: "lb1",
            site: "dc-berlin",
        });
    });

    it("clears the site with null when the field is empty", () => {
        expect(clientInputFrom(draft({ site: "  " }), false, NOTHING)).toMatchObject({ site: null });
    });

    it("leaves a stored address alone that the schema would refuse today", () => {
        const stored = { ...NOTHING, inboundAllowedIp: "fe80::1" };
        const d = draft({ restrictIp: true, allowedIp: "fe80::1", displayName: "lb1" });
        expect(clientInputFrom(d, false, stored)).not.toHaveProperty("inboundAllowedIp");
        expect(check(d, false, stored).isValid).toBe(true);
    });

    it("switches the address check off with null, and only when one is stored", () => {
        expect(clientInputFrom(draft(), false, { ...NOTHING, inboundAllowedIp: "10.0.0.1" })).toMatchObject({
            inboundAllowedIp: null,
        });
        expect(clientInputFrom(draft(), false, NOTHING)).not.toHaveProperty("inboundAllowedIp");
    });

    it("sends the address that belongs to the connection mode, never the other", () => {
        const d = draft({ targetAddress: "10.0.0.5:8443", restrictIp: true, allowedIp: "10.0.0.0/24" });
        expect(clientInputFrom(d, true, NOTHING)).toMatchObject({ outboundTargetAddress: "10.0.0.5:8443" });
        expect(clientInputFrom(d, true, NOTHING)).not.toHaveProperty("inboundAllowedIp");
        expect(clientInputFrom(d, false, NOTHING)).toMatchObject({ inboundAllowedIp: "10.0.0.0/24" });
        expect(clientInputFrom(d, false, NOTHING)).not.toHaveProperty("outboundTargetAddress");
    });
});

describe("the client form's verdict", () => {
    it("reports a changed address the schema refuses at its field", () => {
        expect(check(draft({ restrictIp: true, allowedIp: "not-an-ip" }), false).errors.allowedIp).toBeDefined();
        expect(check(draft({ targetAddress: "http://10.0.0.5/x" }), true).errors.targetAddress).toBeDefined();
    });

    it("requires the allowed address only while the box is ticked", () => {
        expect(check(draft({ restrictIp: true }), false).errors.allowedIp).toMatch(/untick/);
        expect(check(draft(), false).isValid).toBe(true);
    });

    it("requires the target address of an outbound client", () => {
        expect(check(draft(), true).errors.targetAddress).toBeDefined();
        expect(check(draft({ targetAddress: "10.0.0.5" }), true).isValid).toBe(true);
    });

    it("reports a site that is too long at the site", () => {
        expect(check(draft({ site: "x".repeat(101) }), false).errors.site).toBeDefined();
    });
});

describe("significantClientDraft", () => {
    it("does not count an address left under an unticked box", () => {
        const a = significantClientDraft(draft({ allowedIp: "10.0.0.1" }), false);
        expect(isSameDraft(a, significantClientDraft(draft(), false))).toBe(true);
    });

    it("counts unticking the box", () => {
        const ticked = significantClientDraft(draft({ restrictIp: true, allowedIp: "10.0.0.1" }), false);
        expect(isSameDraft(ticked, significantClientDraft(draft({ allowedIp: "10.0.0.1" }), false))).toBe(false);
    });

    it("does not count surrounding whitespace", () => {
        const a = significantClientDraft(draft({ displayName: " lb1 ", site: "dc " }), true);
        expect(isSameDraft(a, significantClientDraft(draft({ displayName: "lb1", site: "dc" }), true))).toBe(true);
    });
});

describe("storedClientDraft", () => {
    it("holds the trimmed values the server keeps", () => {
        expect(storedClientDraft(draft({ displayName: " lb1 ", site: " dc ", allowedIp: " 10.0.0.1 " }))).toEqual(
            draft({ displayName: "lb1", site: "dc", allowedIp: "10.0.0.1" }),
        );
    });
});
