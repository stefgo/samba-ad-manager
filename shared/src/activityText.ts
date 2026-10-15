import { formatDuration } from "./domainHealth.js";
import type { ActivityRecord } from "./types.js";

/**
 * Turns an event into the sentence a reader sees -- on the dashboard and in a webhook alike.
 *
 * This is the one place a wording exists. An event is stored as a kind with its facts and
 * nothing else, so a wording can be changed here and every event already stored reads the
 * new way.
 *
 * A kind nobody here knows still has to read as something: the fallback prints the kind
 * itself, because dropping the line would hide that something happened.
 */

/** The server's schedulers as the settings page names them. */
const SCHEDULER_NAMES: Record<string, string> = {
    "notification-cleanup": "Activity cleanup",
};

function str(event: ActivityRecord, key: string): string | null {
    const value = event.data?.[key];
    return typeof value === "string" && value.length > 0 ? value : null;
}

function num(event: ActivityRecord, key: string): number | null {
    const value = event.data?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const errorsText = (count: number) => `${count} ${count === 1 ? "error" : "errors"}`;

function dc(event: ActivityRecord): string {
    return str(event, "dcName") ?? event.subject?.name ?? "A domain controller";
}

/** The kind of object a directory event is about, as a word in a sentence. */
const OBJECT_WORDS: Record<string, string> = {
    user: "user",
    group: "group",
    computer: "computer",
    ou: "organizational unit",
    container: "container",
    "dns-record": "DNS record",
};

/** "jdoe created user asmith": who did what to which object. `rest` follows the object's name. */
function directoryAction(event: ActivityRecord, verb: string, rest = ""): string {
    const actor = str(event, "actor") ?? "Somebody";
    const type = str(event, "type");
    const word = (type && OBJECT_WORDS[type]) ?? "object";
    const name = str(event, "name") ?? event.subject?.name ?? "?";
    return `${actor} ${verb} ${word} ${name}${rest}`;
}

/** What a DNS record says, behind its name: ` A 192.0.2.10`. */
function recordText(event: ActivityRecord): string {
    const record = str(event, "record");
    return record ? ` ${record}` : "";
}

function count(event: ActivityRecord, key: string): number | null {
    const value = event.data?.[key];
    return typeof value === "number" ? value : null;
}

export function activityMessage(event: ActivityRecord): string {
    switch (event.kind) {
        case "domain.issue_opened":
            return str(event, "text") ?? "Something is wrong with the domain";
        case "domain.issue_resolved": {
            const text = str(event, "text");
            const seconds = count(event, "durationSeconds");
            const after = seconds === null ? "" : ` after ${formatDuration(seconds)}`;
            return text ? `Resolved${after}: ${text}` : `A finding was resolved${after}`;
        }
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
        // The name is the one the record is under; what it says follows, and for a change what it said before.
        case "directory.dns_record_created":
            return directoryAction(event, "created", recordText(event));
        case "directory.dns_record_updated": {
            const was = str(event, "was");
            return directoryAction(event, "changed", `${recordText(event)}${was ? ` (was ${was})` : ""}`);
        }
        case "directory.dns_record_deleted":
            return directoryAction(event, "deleted", recordText(event));
        case "dc.discovered":
            return `${dc(event)} is a domain controller of this domain`;
        case "dc.removed":
            return `${dc(event)} is no longer a domain controller of this domain`;
        case "agent.registered":
            return `An agent registered for ${dc(event)}`;
        case "agent.updated": {
            const actor = str(event, "actor");
            const address = str(event, "targetAddress") ?? "another address";
            return actor
                ? `${actor} set where the agent of ${dc(event)} is dialled to ${address}`
                : `The agent of ${dc(event)} is dialled at ${address}`;
        }
        case "agent.removed": {
            const actor = str(event, "actor");
            return actor ? `${actor} removed the agent of ${dc(event)}` : `The agent of ${dc(event)} was removed`;
        }
        case "agent.dbcheck_fix_requested": {
            const actor = str(event, "actor");
            return actor
                ? `${actor} had the agent of ${dc(event)} fix the errors of its database check`
                : `The agent of ${dc(event)} was asked to fix the errors of its database check`;
        }
        // Why a fix failed is the event's detail.
        case "agent.dbcheck_fixed": {
            const found = num(event, "errorsFound");
            const remaining = num(event, "errorsRemaining");
            if (found === null) return `The agent of ${dc(event)} could not fix its database`;
            if (found === 0) return `The agent of ${dc(event)} found nothing to fix in its database`;
            const fixed = `The agent of ${dc(event)} went at ${errorsText(found)} in its database`;
            if (remaining === null) return `${fixed}; the check after it could not be run`;
            return remaining === 0 ? `${fixed}, and none is left` : `${fixed}; ${errorsText(remaining)} ${remaining === 1 ? "remains" : "remain"}`;
        }
        case "agent.replication_sync_requested": {
            const actor = str(event, "actor");
            return actor ? `${actor} had ${dc(event)} replicate from its partners` : `${dc(event)} was asked to replicate from its partners`;
        }
        // Why it failed, or which links did, is the event's detail.
        case "agent.replication_synced": {
            const links = num(event, "links") ?? 0;
            const failed = num(event, "failed") ?? 0;
            if (links === 0) return str(event, "error") ? `${dc(event)} could not replicate` : `${dc(event)} has no partner to replicate from`;
            const linksText = `${links} ${links === 1 ? "link" : "links"}`;
            if (failed === 0) return `${dc(event)} replicated from its partners, ${linksText}`;
            return `${dc(event)} replicated from its partners; ${failed} of ${linksText} failed`;
        }
        case "scheduler.failed": {
            const scheduler = str(event, "scheduler");
            const error = str(event, "error");
            const what = scheduler ? (SCHEDULER_NAMES[scheduler] ?? scheduler) : "A scheduled job";
            return error ? `${what} failed: ${error}` : `${what} failed`;
        }
        default:
            // A kind another version wrote. Better an unpolished line than none.
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
