import { describe, expect, it } from "vitest";
import { notMeasuringNotice } from "./notMeasuringNotice";

describe("notMeasuringNotice", () => {
    it("names both settings, as the file and as the environment has them", () => {
        const text = notMeasuringNotice().lines.join(" ");
        for (const name of ["samba.container", "SADM_SAMBA_CONTAINER", "ldap.url", "SADM_LDAP_URL"]) {
            expect(text).toContain(name);
        }
    });

    it("says that the agent has to be restarted", () => {
        expect(notMeasuringNotice().lines.join(" ")).toContain("restart");
    });
});
