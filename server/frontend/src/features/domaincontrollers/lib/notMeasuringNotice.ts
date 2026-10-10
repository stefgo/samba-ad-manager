/**
 * What the page of a connected client says whose agent has nothing to read its domain
 * controller from: which settings are missing, and where. Without it the page waits for a
 * measurement that never comes.
 */
export interface NotMeasuringNotice {
    title: string;
    lines: string[];
}

export function notMeasuringNotice(): NotMeasuringNotice {
    return {
        title: "This agent is connected, but has nothing to read its domain controller from",
        lines: [
            "Neither a Samba container nor a directory is set in the agent's config.yaml. Name the container in samba.container (SADM_SAMBA_CONTAINER), the directory in ldap.url (SADM_LDAP_URL), or both.",
            "The agent reads its configuration when it starts: restart it afterwards. Its log names what is missing.",
        ],
    };
}
