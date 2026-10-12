import { logger } from "./logger.js";
import { AgentIdentitySchema } from "@sadm/shared";
import { DATA_DIR, quarantineFile, readJsonFile, writeJsonFile } from "./DataStore.js";
import { CONFIG_PATH, rawValue, removeKey, save } from "./ConfigFile.js";

/**
 * What the server issued at registration: the client id and the auth token, always the pair.
 * Every later connection is checked as a pair, so one half without the other is the same as
 * having neither.
 */
export type AgentIdentity = { clientId: string; authToken: string };

const IDENTITY_FILE = "identity.json";

/**
 * The identity lives in the agent's data directory, not in config.yaml.
 *
 * It is not configuration: the agent never picks it, the operator never writes it, and an id
 * chosen by the caller is what would let a registration take over an existing client. Keeping
 * it here buys two things the config file cannot give it -- the write is atomic and synced
 * (see DataStore.ts), and it goes to a directory that is meant to be written,
 * rather than to a single-file bind mount the operator also edits by hand.
 */
let identity: AgentIdentity | null = null;

/**
 * A file that is there but is not an identity is set aside rather than discarded: it is the
 * only copy of the registration, and the next registration would write over it. What went
 * wrong with it is then still there to be looked at, or to be repaired and put back.
 */
function readFromDisk(): AgentIdentity | null {
    const stored = readJsonFile(IDENTITY_FILE, { quarantine: true });
    if (stored === null) return null;
    const parsed = AgentIdentitySchema.safeParse(stored);
    if (!parsed.success) {
        const movedTo = quarantineFile(IDENTITY_FILE);
        logger.error(
            { file: IDENTITY_FILE, movedTo },
            "The stored identity is not a client id and auth token and was set aside. Register this agent again.",
        );
        return null;
    }
    return parsed.data;
}

/**
 * Moves an identity written by an older version out of config.yaml.
 *
 * The values are copied first and the keys removed only once that worked, so a failed write
 * leaves the agent exactly as it was rather than without an identity at all. The keys go
 * with the comments that describe them: they are no longer read from there, and a comment
 * explaining a key the agent ignores is worse than no comment.
 *
 * A file holding only one of the two is not migrated -- it could not connect either way --
 * but the leftovers are still cleared out.
 */
function migrateFromConfigFile(): AgentIdentity | null {
    const clientId = rawValue("clientId");
    const authToken = rawValue("authToken");
    const hasKeys = clientId !== undefined || authToken !== undefined;
    if (!hasKeys) return null;

    const migrated =
        typeof clientId === "string" && clientId.trim() && typeof authToken === "string" && authToken.trim()
            ? { clientId: clientId.trim(), authToken: authToken.trim() }
            : null;

    if (migrated && !writeJsonFile(IDENTITY_FILE, migrated)) {
        logger.error(
            { dataDir: DATA_DIR },
            "Could not move the identity out of config.yaml -- the data directory is not writable. Leaving it where it is.",
        );
        return migrated;
    }

    removeKey("clientId");
    removeKey("authToken");
    if (save()) {
        logger.info(
            { from: CONFIG_PATH, to: `${DATA_DIR}/${IDENTITY_FILE}` },
            migrated
                ? "Moved the identity out of config.yaml into the data directory"
                : "Removed an incomplete identity from config.yaml -- register this agent again",
        );
    }
    return migrated;
}

identity = readFromDisk() ?? migrateFromConfigFile();

export function getIdentity(): AgentIdentity | null {
    return identity;
}

/**
 * Stores the identity the server issued. Both halves in one write: a file holding one
 * without the other could not connect and would have to be registered again anyway.
 *
 * Answers whether it reached the disk. It is held in memory either way, so the agent that
 * has just registered connects; what a `false` costs is the next restart, and the caller
 * says so where somebody is looking.
 */
export function setIdentity(clientId: string, authToken: string): boolean {
    identity = { clientId, authToken };
    return writeJsonFile(IDENTITY_FILE, identity);
}
