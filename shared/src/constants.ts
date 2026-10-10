export const WS_EVENTS = {
    // Client -> Server
    AUTH: "AUTH",

    /** Client → Server: one measurement of the agent's domain controller. */
    DC_HEALTH: "DC_HEALTH",
    /** Client → Server: the answer to an `AGENT_REQUEST`. */
    AGENT_RESPONSE: "AGENT_RESPONSE",

    // Server -> Client (Agent)
    AUTH_SUCCESS: "AUTH_SUCCESS",
    AUTH_FAILURE: "AUTH_FAILURE",
    /** Server → Client: do one of the actions in `AGENT_ACTIONS` and answer. */
    AGENT_REQUEST: "AGENT_REQUEST",

    // Server -> Dashboard
    CLIENTS_UPDATE: "CLIENTS_UPDATE",
    /** Server → Dashboard: one client's last measurement of its domain controller. */
    DC_HEALTH_UPDATE: "DC_HEALTH_UPDATE",

    // Activity events
    /** Client → Server: a batch of events the agent has not had acknowledged yet. */
    ACTIVITY: "ACTIVITY",
    /** Server → Client: the ids it has stored, so the agent can drop them from its queue. */
    ACTIVITY_ACK: "ACTIVITY_ACK",
    /** Server → Dashboard: the current activity list. */
    ACTIVITY_UPDATE: "ACTIVITY_UPDATE",
    /**
     * Server → Dashboard: events stored for the first time, to be merged into the list the
     * dashboard already holds. A repeat the server already had is not sent again.
     */
    ACTIVITY_APPENDED: "ACTIVITY_APPENDED",
    /** Server → Dashboard: `{ ids }` the user of this session has just seen. Sent to that user only. */
    ACTIVITY_SEEN: "ACTIVITY_SEEN",

    // Scheduler events
    /** Server → Dashboard: one scheduler's status, whenever a run starts or ends. */
    SCHEDULER_STATUS_UPDATE: "SCHEDULER_STATUS_UPDATE",

    // Inbound registration (Server → Client via /ws/register)
    REGISTRATION_REQUEST: "REGISTRATION_REQUEST",   // Server → Client: send secret + authToken
    REGISTRATION_SUCCESS: "REGISTRATION_SUCCESS",   // Client → Server: registration accepted
    REGISTRATION_FAILURE: "REGISTRATION_FAILURE",   // Client → Server: secret mismatch

    // Internal
    ERROR: "ERROR",
} as const;

/**
 * What an agent says it can do, in the `capabilities` list of its AUTH payload. An agent
 * that predates a capability simply does not name it -- the server then knows not to expect
 * that behaviour of it, instead of inferring it from a version string it would have to keep
 * comparing.
 *
 * A new message does not earn an entry here. Both routers drop what they do not recognise,
 * so an agent that has never heard of a message simply does nothing with it, and that is
 * usually the correct outcome. A capability is added only where that silence would produce
 * either a wrong decision on the server -- one that assumes the agent acted -- or a question
 * to the operator that cannot be answered without knowing the agent's answer.
 */
export const AGENT_CAPABILITIES = {
    /** Measures the health of the domain controller it runs next to. */
    HEALTH: "health",
    /** Reads and changes directory objects on that domain controller. */
    DIRECTORY: "directory",
} as const;

/**
 * The port an agent's local web server listens on unless its config.yaml names another.
 * The server appends it when an outbound target address is given without one, and the
 * agent falls back to it -- one number for both sides of the same default.
 */
export const DEFAULT_AGENT_PORT = 3021;

/**
 * The port the server listens on unless config.yaml or the PORT environment variable names
 * another. It is the published one: the container exposes it and the compose files map it,
 * so an operator who moves the server has to move those with it.
 */
export const DEFAULT_SERVER_PORT = 3020;

/**
 * Whether the server currently holds a WebSocket to the agent. Deliberately binary:
 * ProxyService derives it from its map of open connections on every broadcast, and there
 * is no third state it could report. `busy` used to be listed here without anything ever
 * producing or reading it.
 */
export const CLIENT_STATUS = {
    ONLINE: "online",
    OFFLINE: "offline",
} as const;

/**
 * Which side opens the agent connection: `inbound` agents dial the server, `outbound`
 * agents are dialled by it. SQL strings and migrations keep the literals -- a migration
 * must not depend on today's code.
 */
export const CONNECTION_MODE = {
    INBOUND: "inbound",
    OUTBOUND: "outbound",
} as const;

/**
 * Who put an event on the wire. The agent owns everything that happens on its host; the
 * server owns what only it can know -- whether an agent is connected and that one registered.
 */
export const ACTIVITY_SOURCES = ["agent", "server"] as const;

/**
 * Ordered by severity, lowest first -- `ACTIVITY_LEVELS.indexOf` compares two levels.
 * `trace` is routine bookkeeping, such as an agent connecting or disconnecting; the dashboard
 * hides it unless asked to show it.
 */
export const ACTIVITY_LEVELS = ["trace", "info", "warning", "error"] as const;

/**
 * Every kind of event this build knows how to phrase. It is *not* what the wire accepts:
 * an agent of another version may report a kind that is not in here, and dropping it would
 * lose a fact the agent went to the trouble of observing. The server stores whatever it is
 * handed and the dashboard falls back to a generic line for a kind it does not know -- which
 * is the whole point of events carrying structure instead of a sentence.
 */
export const ACTIVITY_KINDS = [
    // Reported by the server
    "client.connected",
    "client.disconnected",
    "client.registered",
    "scheduler.failed",
] as const;

/** The HTTP methods a webhook may send with. Both carry a body; GET does not. */
export const WEBHOOK_METHODS = ["POST", "PUT"] as const;

/**
 * The background jobs the server runs on a timer. Each keeps one row in `scheduler_state`:
 * its last finished run and whatever it has to remember from one run to the next.
 */
export const SCHEDULER_IDS = ["notification-cleanup", "token-cleanup"] as const;

/** Whether the timer started a run or a user did, through the settings page. */
export const SCHEDULER_TRIGGERS = ["schedule", "manual"] as const;

/**
 * How a finished run ended. `partial` finished but left work undone; `interrupted` never
 * finished, because the server stopped while it ran.
 */
export const SCHEDULER_RUN_STATUSES = ["success", "partial", "failed", "interrupted"] as const;
