import { Connection } from "./core/Connection.js";
import { startWebServer, stopWebServer } from "./web/server.js";
import { logger } from "@sadm/shared/node";
import { ActivityService } from "./services/ActivityService.js";
import { HealthService } from "./services/HealthService.js";
import { WS_EVENTS } from "@sadm/shared";
import { ensureDataDir } from "./core/DataStore.js";
import { config, LDAP_PASSWORD } from "./core/Config.js";
import { sourceNotes } from "./core/sourceNotes.js";

ensureDataDir();

// Which routes it serves -- and whether it starts at all -- follows from config.yaml; see
// getWebRoutes(). Awaited so the process handlers below are only in place once startup is
// done. startWebServer() already catches and logs a failed listen(); without the await, a
// failing plugin registration would end up in the unhandledRejection handler instead of
// aborting the start.
await startWebServer();

// An agent without a source starts and connects like any other, so the log has to say it.
for (const note of sourceNotes({
    container: !!config.samba.container,
    ldapUrl: !!config.ldap.url,
    bindDn: !!config.ldap.bindDn,
    password: !!LDAP_PASSWORD,
})) {
    logger[note.level](note.message);
}

// Before the connection, deliberately: the measurements belong to the domain controller,
// not to the link. Does nothing unless config.yaml names a container or a directory.
HealthService.start((report) => {
    Connection.send(WS_EVENTS.DC_HEALTH, report);
});
// A server that has just accepted this agent gets the current state at once.
// An agent with nothing to measure sends nothing: an empty report would stand on the server
// as a measurement.
Connection.onConnected(() => {
    if (!HealthService.isConfigured()) return;
    HealthService.resetSent();
    void HealthService.refresh().catch((err) => logger.warn({ err }, "Could not measure for the new connection"));
});

// Try to connect to server
Connection.connect();

// Handle graceful shutdown
const shutdown = async () => {
    logger.info("Received shutdown signal, terminating client...");
    // Before anything else: whatever the server has not acknowledged is only in memory
    // and in a write that may still be pending, and this process is about to end.
    ActivityService.persistNow();
    await stopWebServer();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Registered only after startup, so a failed start (web server plugins) still fails fast
// instead of being swallowed here.

// The agent has to survive a stray rejection: it holds the connection the server
// monitors this host through, and nobody is watching it interactively.
process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
});

// An uncaught exception leaves the process in an unknown state. Log it and exit so
// the supervisor restarts us (compose.yaml: restart: unless-stopped).
process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception, terminating");
    // The coalesced write may still be pending; the events it holds would die with the
    // process. Guarded, because the state that threw may be the queue's own.
    try {
        ActivityService.persistNow();
    } catch (persistErr) {
        logger.error({ err: persistErr }, "Could not persist the activity queue");
    }
    // Give the pino transport worker a moment to flush before we go.
    setTimeout(() => process.exit(1), 250);
});
