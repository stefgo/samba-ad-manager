/**
 * The agent itself: everything `index.ts` starts once it knows it is not merely asked for
 * its version. Importing this module reads config.yaml and the data directory.
 */
import { Connection } from "./core/Connection.js";
import { startWebServer, stopWebServer } from "./web/server.js";
import { logger } from "./core/logger.js";
import { ensureDataDir } from "./core/DataStore.js";
import { REGISTRATION_TOKEN } from "./core/Config.js";
import { getDcId, setDcId } from "./core/DcIdentity.js";
import { getIdentity } from "./core/Identity.js";
import { registerFromEnvironment } from "./core/Registration.js";
import { getServerUrl } from "./core/RegistrationState.js";
import { DbcheckService } from "./services/DbcheckService.js";
import { ReplicationSyncService } from "./services/ReplicationSyncService.js";
import { LocalService } from "./services/LocalService.js";
import { runSambaHelper } from "./services/SambaHelper.js";

ensureDataDir();

/**
 * Which domain controller this is, from its own database. Everything else waits for it: a
 * registration is good for one domain controller, and every connection says which one this
 * is. The database is there as soon as the domain is provisioned or joined, whether Samba
 * runs or not -- so this only waits where there is no domain controller yet.
 */
async function readDomainController(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        try {
            const info = await runSambaHelper("info");
            setDcId(info.dcId);
            LocalService.configure(info);
            logger.info({ dcId: getDcId(), domain: info.dnsDomain }, "Read which domain controller this agent runs on");
            return;
        } catch (err) {
            const delay = Math.min(60, 5 * 2 ** Math.min(attempt, 4));
            logger.warn(
                `Could not read the local Samba database (${err instanceof Error ? err.message : String(err)}). Trying again in ${delay}s...`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay * 1000));
        }
    }
}

await readDomainController();

// Which routes it serves -- and whether it starts at all -- follows from config.yaml; see
// getWebRoutes(). Awaited so the process handlers below are only in place once startup is
// done.
await startWebServer();

// Before the connection, deliberately: what is read belongs to the domain controller, not to
// the link.
LocalService.start();
DbcheckService.start();
ReplicationSyncService.start();

// An agent nobody opens a page of: registered from its environment, once.
const serverUrl = getServerUrl();
if (!getIdentity() && serverUrl && REGISTRATION_TOKEN) {
    await registerFromEnvironment(serverUrl, REGISTRATION_TOKEN);
} else if (!getIdentity() && serverUrl) {
    logger.warn("Not registered: set SADM_REGISTRATION_TOKEN to a token from the domain controller's page, or use the register page");
}

// Does nothing without an identity and a server URL: an agent the server dials waits for it.
void Connection.connect();

const shutdown = async () => {
    logger.info("Received shutdown signal, terminating the agent...");
    LocalService.stop();
    await stopWebServer();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Registered only after startup, so a failed start still fails fast instead of being
// swallowed here.

// The agent has to survive a stray rejection: nobody is watching it interactively.
process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
});

// An uncaught exception leaves the process in an unknown state. Log it and exit so the
// supervisor starts it again.
process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception, terminating");
    // Give the pino transport worker a moment to flush before we go.
    setTimeout(() => process.exit(1), 250);
});
