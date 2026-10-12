import { describe, expect, it } from "vitest";
import { ConnectAgentSchema } from "@sadm/shared";
import { agentDirection, connectAgentDraftFrom, connectAgentFieldOf, connectAgentInputFrom } from "./agentForm";

describe("connectAgentDraftFrom", () => {
    it("starts where the domain controller is reached, on the agent's port", () => {
        expect(connectAgentDraftFrom({ address: null, dnsHostName: "dc1.sadm.test" }).targetAddress).toBe("dc1.sadm.test:3021");
        expect(connectAgentDraftFrom({ address: "10.0.0.1", dnsHostName: "dc1.sadm.test" }).targetAddress).toBe("10.0.0.1:3021");
    });

    it("starts empty for one the directory names no host for", () => {
        expect(connectAgentDraftFrom({ address: null, dnsHostName: null })).toEqual({ targetAddress: "", registrationSecret: "" });
    });
});

describe("connectAgentInputFrom", () => {
    it("sends what was typed, without the blanks around it", () => {
        const input = connectAgentInputFrom({ targetAddress: " dc1.sadm.test:3021 ", registrationSecret: " ABCD-EFGH " });
        expect(input).toEqual({ targetAddress: "dc1.sadm.test:3021", registrationSecret: "ABCD-EFGH" });
        expect(ConnectAgentSchema.safeParse(input).success).toBe(true);
    });

    it("is refused by the request schema without a PIN, and with an address that is a URL", () => {
        const noPin = ConnectAgentSchema.safeParse(connectAgentInputFrom({ targetAddress: "dc1:3021", registrationSecret: "" }));
        expect(noPin.success).toBe(false);
        expect(connectAgentFieldOf(noPin.error!.issues[0].path)).toBe("registrationSecret");
        const url = ConnectAgentSchema.safeParse(connectAgentInputFrom({ targetAddress: "http://dc1:3021/x", registrationSecret: "1" }));
        expect(connectAgentFieldOf(url.error!.issues[0].path)).toBe("targetAddress");
    });
});

describe("agentDirection", () => {
    it("says who dials whom", () => {
        expect(agentDirection({ connectionMode: "inbound", targetAddress: null })).toBe("It dials this server");
        expect(agentDirection({ connectionMode: "outbound", targetAddress: "dc2.sadm.test:3021" })).toBe(
            "This server dials it at dc2.sadm.test:3021",
        );
    });
});
