import { describe, expect, it } from "vitest";
import { sourceNotes } from "./sourceNotes.js";

const all = { container: true, ldapUrl: true, bindDn: true, password: true };

describe("sourceNotes", () => {
    it("says nothing when every source is set", () => {
        expect(sourceNotes(all)).toEqual([]);
    });

    it("warns once, naming both settings, when there is no source at all", () => {
        const notes = sourceNotes({ container: false, ldapUrl: false, bindDn: false, password: false });
        expect(notes).toHaveLength(1);
        expect(notes[0].level).toBe("warn");
        expect(notes[0].message).toContain("SADM_SAMBA_CONTAINER");
        expect(notes[0].message).toContain("SADM_LDAP_URL");
    });

    it("does not ask for an account where there is no directory to bind to", () => {
        const notes = sourceNotes({ container: true, ldapUrl: false, bindDn: false, password: false });
        expect(notes).toHaveLength(1);
        expect(notes[0].level).toBe("info");
        expect(notes[0].message).toContain("SADM_LDAP_URL");
    });

    it("names the container when only the directory is set", () => {
        const notes = sourceNotes({ ...all, container: false });
        expect(notes).toHaveLength(1);
        expect(notes[0].message).toContain("SADM_SAMBA_CONTAINER");
    });

    it("names what of the account is missing", () => {
        const [noPassword] = sourceNotes({ ...all, password: false });
        expect(noPassword.level).toBe("info");
        expect(noPassword.message).toContain("SADM_LDAP_PASSWORD");
        expect(noPassword.message).not.toContain("SADM_LDAP_BIND_DN");

        const [neither] = sourceNotes({ ...all, bindDn: false, password: false });
        expect(neither.message).toContain("SADM_LDAP_BIND_DN");
        expect(neither.message).toContain("SADM_LDAP_PASSWORD");
    });
});
