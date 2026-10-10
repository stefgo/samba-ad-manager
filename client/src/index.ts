import { Connection } from "./core/Connection.js";
import { startWebServer, stopWebServer } from "./web/server.js";
import { logger } from "@sadm/shared/node";
import { ActivityService } from "./services/ActivityService.js";
import { ensureDataDir } from "./core/DataStore.js";

ensureDataDir();

// Which routes it serves -- and whether it starts at all -- follows from config.yaml; see
// getWebRoutes(). Awaited so the process handlers below are only in place once startup is
// done. startWebServer() already catches and logs a failed listen(); without the await, a
// failing plugin registration would end up in the unhandledRejection handler instead of
// aborting the start.
await startWebServer();

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
