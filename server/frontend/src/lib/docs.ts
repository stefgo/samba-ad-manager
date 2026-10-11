/** Where the published documentation is. Every link into it starts here. */
const DOCS_BASE = "https://stefgo.github.io/samba-ad-manager";

/** The pages the application links to. */
export const DOCS = {
    /** Setting up the script that reports a domain controller's database check. */
    dbcheck: `${DOCS_BASE}/dbcheck/`,
    webhookConditions: `${DOCS_BASE}/webhooks/#conditions-and-loops`,
} as const;
