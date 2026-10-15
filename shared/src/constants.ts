/** What the server pushes to an open dashboard over `/ws/dashboard`. */
export const WS_EVENTS = {
    /** The domain controllers the directory lists, whenever that list or one of them changes. */
    DOMAIN_CONTROLLERS_UPDATE: "DOMAIN_CONTROLLERS_UPDATE",
    /** One domain controller's last measurement, with what its agent last reported. */
    DC_HEALTH_UPDATE: "DC_HEALTH_UPDATE",
    /** The current activity list. */
    ACTIVITY_UPDATE: "ACTIVITY_UPDATE",
    /** Events stored just now, to be merged into the list the dashboard already holds. */
    ACTIVITY_APPENDED: "ACTIVITY_APPENDED",
    /** `{ ids }` the user of this session has just seen. Sent to that user only. */
    ACTIVITY_SEEN: "ACTIVITY_SEEN",
    /** One scheduler's status, whenever a run starts or ends. */
    SCHEDULER_STATUS_UPDATE: "SCHEDULER_STATUS_UPDATE",
    /** The name servers of the domain that are no domain controllers, as last asked. */
    DNS_SERVERS_UPDATE: "DNS_SERVERS_UPDATE",
} as const;

/**
 * The port the server listens on unless config.yaml or the PORT environment variable names
 * another. It is the published one: the container exposes it and the compose files map it,
 * so an operator who moves the server has to move those with it.
 */
export const DEFAULT_SERVER_PORT = 3020;

/**
 * Ordered by severity, lowest first -- `ACTIVITY_LEVELS.indexOf` compares two levels.
 * `trace` is routine bookkeeping; the dashboard hides it unless asked to show it.
 */
export const ACTIVITY_LEVELS = ["trace", "info", "warning", "error"] as const;

/**
 * Every kind of event this build writes and knows how to phrase. A stored event may still
 * carry a kind that is not in here -- one written by another version -- and the dashboard
 * falls back to a generic line for it.
 */
export const ACTIVITY_KINDS = [
    // A domain controller the directory lists for the first time, and one it no longer lists
    "dc.discovered",
    "dc.removed",
    // An agent that registered for a domain controller, one that is dialled somewhere else from now on, and one that was removed
    "agent.registered",
    "agent.updated",
    "agent.removed",
    // A fix of a domain controller's database: that somebody asked for it, and how it went
    "agent.dbcheck_fix_requested",
    "agent.dbcheck_fixed",
    "scheduler.failed",
    // About the domain as a whole: a finding that appeared, and one that went
    "domain.issue_opened",
    "domain.issue_resolved",
    // What an account changed in the directory
    "directory.user_created",
    "directory.user_updated",
    "directory.password_set",
    "directory.user_unlocked",
    "directory.account_enabled",
    "directory.account_disabled",
    "directory.group_created",
    "directory.group_updated",
    "directory.members_added",
    "directory.members_removed",
    "directory.computer_updated",
    "directory.ou_created",
    "directory.ou_updated",
    "directory.object_moved",
    "directory.object_renamed",
    "directory.object_deleted",
    "directory.dns_record_created",
    "directory.dns_record_updated",
    "directory.dns_record_deleted",
] as const;

/** The HTTP methods a webhook may send with. Both carry a body; GET does not. */
export const WEBHOOK_METHODS = ["POST", "PUT"] as const;

/**
 * The background jobs the server runs on a timer. Each keeps one row in `scheduler_state`:
 * its last finished run and whatever it has to remember from one run to the next.
 */
export const SCHEDULER_IDS = ["notification-cleanup"] as const;

/** Whether the timer started a run or a user did, through the settings page. */
export const SCHEDULER_TRIGGERS = ["schedule", "manual"] as const;

/**
 * How a finished run ended. `partial` finished but left work undone; `interrupted` never
 * finished, because the server stopped while it ran.
 */
export const SCHEDULER_RUN_STATUSES = ["success", "partial", "failed", "interrupted"] as const;
