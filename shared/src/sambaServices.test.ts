import { describe, expect, it } from "vitest";
import { missingSambaServices, sambaServiceLabel } from "./sambaServices.js";

const running = (...names: string[]) => names.map((name) => ({ name, pids: [100] }));

describe("missingSambaServices", () => {
    it("finds nothing missing where every configured service is registered", () => {
        expect(
            missingSambaServices({
                configured: ["s3fs", "rpc", "ldap", "kdc", "drepl", "kcc", "dnsupdate"],
                running: running("rpc_server", "ldap_server", "kdc_server", "dreplsrv", "kccsrv", "dnsupdate"),
            }),
        ).toEqual([]);
    });

    it("names a configured service that is not registered, as smb.conf names it", () => {
        expect(missingSambaServices({ configured: ["ldap", "kdc", "drepl"], running: running("ldap_server", "kdc_server") })).toEqual([
            "drepl",
        ]);
    });

    it("does not count a service that is registered without a process", () => {
        expect(missingSambaServices({ configured: ["kdc"], running: [{ name: "kdc_server", pids: [] }] })).toEqual(["kdc"]);
    });

    it("says nothing about a service it does not know, or one that registers nothing", () => {
        expect(missingSambaServices({ configured: ["s3fs", "wrepl", "ntp_signd", "something_new"], running: [] })).toEqual([]);
    });

    // What `server services` and Samba's messaging said on dc1 of the development domain (Samba 4.22, prefork).
    it("finds nothing missing on a domain controller of the development domain", () => {
        expect(
            missingSambaServices({
                configured: ["s3fs", "rpc", "nbt", "wrepl", "ldap", "cldap", "kdc", "drepl", "winbindd", "ntp_signd", "kcc", "dnsupdate", "dns"],
                running: running(
                    "dnsupdate",
                    "prefork-master-ldap",
                    "cldap_server",
                    "rpc_server",
                    "nbt_server",
                    "winbind_server",
                    "kdc_server",
                    "notify-daemon",
                    "ldap_server",
                    "kccsrv",
                    "samba",
                    "dreplsrv",
                    "dnssrv",
                ),
            }),
        ).toEqual([]);
    });

    it("expects nothing that is not configured", () => {
        expect(missingSambaServices({ configured: ["ldap"], running: running("ldap_server") })).toEqual([]);
    });
});

describe("sambaServiceLabel", () => {
    it("says what a service does", () => {
        expect(sambaServiceLabel("drepl")).toBe("replication (drepl)");
        expect(sambaServiceLabel("something_new")).toBe("something_new");
    });
});
