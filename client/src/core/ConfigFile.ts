import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import YAML from "yaml";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The directory the agent was installed in; relative paths in config.yaml resolve here. */
export const ROOT_DIR = path.resolve(__dirname, "../../");

/**
 * `config.yaml` next to the agent, unless SADM_CLIENT_CONFIG names another file -- which
 * lets two agents run from one checkout, as the two of compose.dev.yaml do.
 */
export const CONFIG_PATH =
    process.env.SADM_CLIENT_CONFIG?.trim() || path.resolve(ROOT_DIR, "config.yaml");

/**
 * The file as a YAML document rather than a plain object, and the only place that document
 * lives. Keeping it means an edit writes back the operator's file -- their comments, their
 * order, their spelling -- instead of a re-serialised copy of what the parser understood.
 *
 * An empty document until `load()` says otherwise, so an agent without a config.yaml can
 * still be registered: what it is handed then is written into a file that did not exist.
 */
let doc: YAML.Document = new YAML.Document({});
let loaded = false;
let contents: unknown = null;

/**
 * Reads and parses config.yaml, once. Answers the plain object it holds, or null when there
 * is no file -- which is not an error: a fresh container has none, and registration creates
 * it.
 *
 * A file that exists but cannot be read or parsed answers null as well, with the reason
 * logged. Refusing to start would be the worse failure: the web UI, the one place the
 * operator could fix it from, is the thing that would not come up.
 *
 * Every accessor below goes through this, so the file is read whichever module asks first
 * and no import order has to be arranged by hand.
 */
export function load(): unknown {
    if (loaded) return contents;
    loaded = true;

    if (!fs.existsSync(CONFIG_PATH)) {
        logger.info("No config.yaml found. Using defaults.");
        return contents;
    }
    try {
        doc = YAML.parseDocument(fs.readFileSync(CONFIG_PATH, "utf-8"));
        contents = doc.toJS() ?? null;
    } catch (err) {
        logger.error({ err, path: CONFIG_PATH }, "Failed to load config.yaml");
        doc = new YAML.Document({});
    }
    return contents;
}

/** What the file holds under `key`, unparsed. The migration reads the old identity with it. */
export function rawValue(key: string): unknown {
    load();
    return doc.get(key);
}

export function setValue(key: string, value: string): void {
    load();
    doc.set(key, value);
}

/**
 * Everything in a comment block except its last paragraph, or null when there is only one.
 *
 * The yaml library hangs every comment line preceding a key on that key, which makes the
 * file's own header part of whatever happens to come first. A blank line is what separates
 * the two in the file, so it is what separates them here: the last paragraph describes the
 * key, anything above it does not and has to survive the key's removal.
 */
function sharedCommentAbove(comment: string | null | undefined): string | null {
    if (!comment) return null;
    const lines = comment.split("\n");
    const lastBlank = lines.lastIndexOf("");
    if (lastBlank <= 0) return null;
    return lines.slice(0, lastBlank).join("\n");
}

/**
 * Removes a key along with the comment that describes it -- a key the agent no longer reads
 * should not keep explaining itself in the operator's file. Comments above it that belong to
 * the file rather than to the key are moved down to the next key instead of going with it.
 */
export function removeKey(key: string): void {
    load();
    const map = doc.contents;
    if (!YAML.isMap(map)) return;

    const index = map.items.findIndex(
        (item) => YAML.isPair(item) && YAML.isScalar(item.key) && item.key.value === key,
    );
    if (index === -1) return;

    const removed = map.items[index];
    const keyNode = YAML.isPair(removed) ? removed.key : null;
    const shared = YAML.isScalar(keyNode) ? sharedCommentAbove(keyNode.commentBefore) : null;

    map.items.splice(index, 1);
    if (!shared) return;

    const next = map.items[index];
    const nextKey = YAML.isPair(next) ? next.key : null;
    if (YAML.isScalar(nextKey)) {
        nextKey.commentBefore = nextKey.commentBefore
            ? `${shared}\n\n${nextKey.commentBefore}`
            : `${shared}\n`;
        // The blank line that used to separate this key from the one above it would now be
        // the first line of the file, with the header pushed below it.
        if (index === 0) nextKey.spaceBefore = false;
    } else {
        // Nothing left below it: the block stays as a comment at the end of the file rather
        // than being dropped.
        doc.comment = doc.comment ? `${shared}\n${doc.comment}` : shared;
    }
}

/**
 * Writes the document back. Answers whether it worked, because the caller has to be able to
 * say so: a registration whose file was not written looks successful and is gone at the next
 * restart.
 *
 * Not atomic, and it cannot be where `config.yaml` is a single-file bind mount: the usual
 * temp-file-plus-rename would replace the inode and break the mount. That is the reason the identity is not kept in this file: what is written
 * here is the operator's own settings, which they can write again, and nothing the agent
 * cannot do without.
 */
export function save(): boolean {
    try {
        // Four spaces, like everything else in this repository and like the example config:
        // the library's default is two, which would re-indent every block it touches.
        fs.writeFileSync(CONFIG_PATH, doc.toString({ indent: 4 }));
        return true;
    } catch (err) {
        logger.error({ err, path: CONFIG_PATH }, "Failed to save config.yaml");
        return false;
    }
}
