import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../../");

/**
 * Where the agent keeps what it has to survive a restart -- the identity the server issued,
 * and the last database check until the server has it.
 *
 * In a domain controller's container this is `/var/lib/samba/sadm-client`, set by the start
 * script: below Samba's own state, in the volume that holds the directory's database. A
 * domain controller that is provisioned or joined anew is another one, and the identity of
 * the old one goes with the volume. `SADM_CLIENT_DATA_DIR` moves it.
 *
 * Most of it is scratch state, but `identity.json` is not: it holds the auth token in plain
 * text, and it is the only copy of the registration. That is why this module keeps the
 * directory to the agent, syncs what it writes, and can set a damaged file aside instead of
 * letting the next write replace it.
 */
export const DATA_DIR =
    process.env.SADM_CLIENT_DATA_DIR?.trim() || path.resolve(ROOT_DIR, "data");

/**
 * Creates DATA_DIR at startup, mode 0700, and sets that mode again on an existing directory:
 * tightening the directory protects an `identity.json` an older agent wrote world-readable
 * at once, not only after its next write -- and the identity is written once, at
 * registration.
 *
 * Does not throw. Writes create the directory on demand and report their own failure, and
 * an agent that will not come up over its data directory is the worse failure.
 */
export function ensureDataDir(): void {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
        fs.chmodSync(DATA_DIR, 0o700);
    } catch (err) {
        logger.warn(
            { err, dir: DATA_DIR },
            "Could not restrict the data directory to the agent; it holds the auth token",
        );
    }
}

function pathOf(name: string): string {
    return path.join(DATA_DIR, name);
}

/**
 * Moves a file out of the way under a name nobody writes to, so its content is still there
 * for the operator to look at. Answers the new path, or null if not even that worked.
 */
export function quarantineFile(name: string): string | null {
    const file = pathOf(name);
    const target = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
        fs.renameSync(file, target);
        return target;
    } catch (err) {
        logger.error({ err, file }, "Could not set a damaged data file aside");
        return null;
    }
}

/**
 * Reads one file as JSON. A file that is missing, unreadable or not JSON answers `null`.
 * The caller validates the shape; this only guarantees it is JSON.
 *
 * For scratch state that is the right answer: none of it is worth refusing to start over,
 * and an agent that will not come up because of its own scratch file is the worse failure
 * -- it is the connection the operator would fix it over. For a file that is the only copy
 * of something, `quarantine` sets a damaged one aside first -- a `null` would otherwise read
 * as "nothing stored yet", and the next write would replace what was there for good.
 */
export function readJsonFile(
    name: string,
    options: { quarantine?: boolean } = {},
): unknown | null {
    const file = pathOf(name);
    if (!fs.existsSync(file)) return null;
    try {
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (err) {
        if (options.quarantine) {
            const movedTo = quarantineFile(name);
            logger.error(
                { err, file, movedTo },
                "A data file could not be read and was set aside. Its content is not in use.",
            );
        } else {
            logger.warn({ err, file }, "Discarding an unreadable data file");
        }
        return null;
    }
}

/** fsync on a directory, so a rename inside it is on disk and not just in the page cache. */
function syncDirectory(dir: string): void {
    let fd: number | null = null;
    try {
        fd = fs.openSync(dir, "r");
        fs.fsyncSync(fd);
    } catch {
        // Not every platform lets a directory be opened for this; the rename has happened
        // either way, and this only narrows the window in which a power cut could undo it.
    } finally {
        if (fd !== null) fs.closeSync(fd);
    }
}

/**
 * Writes one file as JSON, atomically: a temporary file next to the target, synced, then a
 * rename, then the directory synced. A plain write that is cut short -- the host losing
 * power mid-update is exactly the situation this state exists for -- would leave half a file
 * behind, and rename is the one operation the filesystem gives us that cannot. The syncs
 * make the rename carry the new content rather than an empty file on a filesystem that
 * reorders the two.
 *
 * Answers whether it worked. The callers that write scratch state ignore that -- a lost
 * reading is taken again -- while the identity has to know, because a registration nobody
 * could save is one the operator has to be told about.
 *
 * Every file is 0600, since `identity.json` carries the auth token. The mode is set
 * explicitly as well as on open: open only applies it when it creates the file, and a `.tmp`
 * left behind by a crash would otherwise keep whatever mode it had.
 */
export function writeJsonFile(name: string, value: unknown): boolean {
    const file = pathOf(name);
    const temp = `${file}.tmp`;
    let fd: number | null = null;
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
        fd = fs.openSync(temp, "w", 0o600);
        fs.fchmodSync(fd, 0o600);
        fs.writeFileSync(fd, JSON.stringify(value, null, 4));
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = null;
        fs.renameSync(temp, file);
        syncDirectory(DATA_DIR);
        return true;
    } catch (err) {
        logger.error({ err, file }, "Failed to write a data file");
        try {
            if (fd !== null) fs.closeSync(fd);
            fs.rmSync(temp, { force: true });
        } catch {
            // Nothing left to do about it; the next write overwrites the leftover.
        }
        return false;
    }
}
