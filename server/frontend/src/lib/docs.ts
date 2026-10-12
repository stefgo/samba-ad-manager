/** Where the published documentation is. Every link into it starts here. */
const DOCS_BASE = "https://stefgo.github.io/samba-ad-manager";

/** The pages the application links to. */
export const DOCS = {
    /** What the agent is, and how it gets into a domain controller's container. */
    agent: `${DOCS_BASE}/agent/`,
    /** The database check the agent runs. */
    dbcheck: `${DOCS_BASE}/agent/#the-database-check`,
    webhookConditions: `${DOCS_BASE}/webhooks/#conditions-and-loops`,
} as const;
