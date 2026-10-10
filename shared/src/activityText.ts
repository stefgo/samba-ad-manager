import type { ActivityRecord } from "./types.js";

/**
 * Turns an event into the sentence a reader sees -- on the dashboard and in a webhook alike.
 *
 * This is the one place a wording exists. An agent reports a kind with its facts and nothing
 * else, so an agent of an older version stays useful without knowing how today's dashboard
 * phrases things -- and a wording can be changed here without asking every domain controller
 * to update.
 *
 * A kind nobody here knows still has to read as something: the fallback prints the kind
 * itself, because dropping the line would hide an observation that cannot be made again.
 */

/** The server's schedulers as the settings page names them. */
const SCHEDULER_NAMES: Record<string, string> = {
    "notification-cleanup": "Activity cleanup",
    "token-cleanup": "Token cleanup",
};

function str(event: ActivityRecord, key: string): string | null {
    const value = event.data?.[key];
    return typeof value === "string" && value.length > 0 ? value : null;
}

function host(event: ActivityRecord): string {
    return str(event, "clientName") ?? "the client";
}

/** The kind of object a directory event is about, as a word in a sentence. */
const OBJECT_WORDS: Record<string, string> = {
    user: "user",
    group: "group",
    computer: "computer",
    ou: "organizational unit",
    container: "container",
};

/** "jdoe created user asmith": who did what to which object. `rest` follows the object's name. */
function directoryAction(event: ActivityRecord, verb: string, rest = ""): string {
    const actor = str(event, "actor") ?? "Somebody";
    const type = str(event, "type");
    const word = (type && OBJECT_WORDS[type]) ?? "object";
    const name = str(event, "name") ?? event.subject?.name ?? "?";
    return `${actor} ${verb} ${word} ${name}${rest}`;
}

function count(event: ActivityRecord, key: string): number | null {
    const value = event.data?.[key];
    return typeof value === "number" ? value : null;
}

export function activityMessage(event: ActivityRecord): string {
    switch (event.kind) {
        case "directory.user_created":
        case "directory.group_created":
        case "directory.ou_created":
            return directoryAction(event, "created");
        case "directory.user_updated":
        case "directory.group_updated":
        case "directory.computer_updated":
        case "directory.ou_updated":
            return directoryAction(event, "changed");
        case "directory.password_set":
            return directoryAction(event, "set the password of");
        case "directory.user_unlocked":
            return directoryAction(event, "unlocked");
        case "directory.account_enabled":
            return directoryAction(event, "enabled");
        case "directory.account_disabled":
            return directoryAction(event, "disabled");
        case "directory.members_added":
        case "directory.members_removed": {
            const members = count(event, "members");
            const what = members === null ? "members" : `${members} ${members === 1 ? "member" : "members"}`;
            return event.kind === "directory.members_added"
                ? directoryAction(event, `added ${what} to`)
                : directoryAction(event, `removed ${what} from`);
        }
        case "directory.object_moved": {
            const target = str(event, "target");
            return directoryAction(event, "moved", target ? ` to ${target}` : "");
        }
        case "directory.object_renamed": {
            const newName = str(event, "newName");
            return directoryAction(event, "renamed", newName ? ` to ${newName}` : "");
        }
        case "directory.object_deleted":
            return directoryAction(event, "deleted");
        case "client.connected":
            return `${host(event)} connected`;
        case "client.disconnected":
            return `${host(event)} disconnected`;
        case "client.registered":
            return `${str(event, "hostname") ?? host(event)} registered`;
        case "scheduler.failed": {
            const scheduler = str(event, "scheduler");
            const error = str(event, "error");
            const what = scheduler ? (SCHEDULER_NAMES[scheduler] ?? scheduler) : "A scheduled job";
            return error ? `${what} failed: ${error}` : `${what} failed`;
        }
        default:
            // A kind from an agent of another version. Better an unpolished line than none.
            return event.kind;
    }
}

/** The second line of an expanded row: what the message left out. */
export function activityDetail(event: ActivityRecord): string | null {
    const error = str(event, "error");
    if (error) return error;
    // Where the object is -- or was: a name alone may be one of several.
    if (event.kind.startsWith("directory.")) return event.subject?.dn ?? null;
    return null;
}
