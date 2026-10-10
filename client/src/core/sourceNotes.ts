/** What of the agent's sources is set -- only whether, never the values. */
export interface SourceState {
    container: boolean;
    ldapUrl: boolean;
    bindDn: boolean;
    password: boolean;
}

export interface SourceNote {
    level: "warn" | "info";
    message: string;
}

/**
 * What an operator should read in the log about the sources this agent was given. An agent
 * without any is a valid one -- it registers and stays connected -- which is exactly why it
 * has to be said: from the server it looks like a domain controller that reports nothing.
 */
export function sourceNotes(state: SourceState): SourceNote[] {
    if (!state.container && !state.ldapUrl) {
        return [
            {
                level: "warn",
                message:
                    "Nothing to read the domain controller from: neither samba.container " +
                    "(SADM_SAMBA_CONTAINER) nor ldap.url (SADM_LDAP_URL) is set. This agent connects " +
                    "to the server and reports nothing about its domain controller.",
            },
        ];
    }

    const notes: SourceNote[] = [];
    if (!state.container) {
        notes.push({
            level: "info",
            message:
                "samba.container (SADM_SAMBA_CONTAINER) is not set: the container's state, replication, " +
                "the service processes and the database check are not read.",
        });
    }
    if (!state.ldapUrl) {
        notes.push({
            level: "info",
            message:
                "ldap.url (SADM_LDAP_URL) is not set: who the domain controller is, its view of the " +
                "domain and the directory are not read.",
        });
    } else if (!state.bindDn || !state.password) {
        const missing = [
            ...(state.bindDn ? [] : ["ldap.bindDn (SADM_LDAP_BIND_DN)"]),
            ...(state.password ? [] : ["its password (SADM_LDAP_PASSWORD or SADM_LDAP_PASSWORD_FILE)"]),
        ];
        notes.push({
            level: "info",
            message:
                `No account for the directory, ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set: ` +
                "only its name, version and state " +
                "are read -- no FSMO roles, no other domain controllers, and the directory cannot be managed.",
        });
    }
    return notes;
}
