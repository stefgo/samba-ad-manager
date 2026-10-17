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

/** ` (3 attempts)` behind the outcome of an operation that took more than one. */
function attemptsText(event: ActivityRecord): string {
    const attempts = num(event, "attempts");
    return attempts !== null && attempts > 1 ? ` (${attempts} attempts)` : "";
}

/** How one fix of the database went, in a few words. */
function fixOutcome(found: number | null, remaining: number | null): string {
    if (found === null) return "failed, nothing was changed";
    if (found === 0) return "nothing to fix";
    const fixed = `went at ${errorsText(found)}`;
    if (remaining === null) return `${fixed}; the check after it could not be run`;
    return remaining === 0 ? `${fixed}, none left` : `${fixed}; ${errorsText(remaining)} ${remaining === 1 ? "remains" : "remain"}`;
}

/** How one replication went, in a few words. */
function syncOutcome(links: number, failed: number, error: string | null): string {
    if (links === 0) return error ? "could not replicate" : "no partner to replicate from";
    const linksText = `${links} ${links === 1 ? "link" : "links"}`;
    return failed === 0 ? `${linksText}, all replicated` : `${failed} of ${linksText} failed`;
}

/** "attempt 1 of 3": which attempt an event is, where it says. */
function attemptOf(event: ActivityRecord): string {
    const attempt = num(event, "attempt");
    const of = num(event, "of");
    return attempt !== null && of !== null ? `attempt ${attempt} of ${of}` : "an attempt";
}

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

/**
 * The findings an incident's event names (`reported`, `escalated`), as one line: the first,
 * and how many more. An event stored before incidents carries its one finding as `text`.
 */
function findingsText(event: ActivityRecord, key: string): string | null {
    const list = event.data?.[key];
    const texts = Array.isArray(list)
        ? list.flatMap((finding: { text?: unknown } | null) =>
              typeof finding?.text === "string" && finding.text.length > 0 ? [finding.text] : [],
          )
        : [];
    if (texts.length === 0) return str(event, "text");
    return texts.length === 1 ? texts[0] : `${texts[0]} and ${texts.length - 1} more`;
}

/** A finding of an incident, as its events list it in `data.findings`. */
export interface IncidentFinding {
    text: string;
    /** The most severe it has been. */
    worstSeverity: string | null;
    /** Null when it was never reported -- it was gone before its report wait ran out. */
    reportedAt: string | null;
    since: string | null;
    lastSeenAt: string | null;
    /** How often it was gone and came back. */
    gaps: number;
}

const optionalString = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/**
 * Every finding of an incident as one of its events left them, or null for an event that
 * lists none -- one of another kind, or stored before incidents. A finding without a text
 * is left out: there would be nothing to show of it.
 */
export function incidentFindings(event: ActivityRecord): IncidentFinding[] | null {
    const list = event.data?.findings;
    if (!event.kind.startsWith("domain.issue_") || !Array.isArray(list)) return null;
    return list.flatMap((finding: Record<string, unknown> | null) => {
        const text = optionalString(finding?.text);
        if (!finding || !text) return [];
        return [
            {
                text,
                worstSeverity: optionalString(finding.worstSeverity) ?? optionalString(finding.severity),
                reportedAt: optionalString(finding.reportedAt),
                since: optionalString(finding.since),
                lastSeenAt: optionalString(finding.lastSeenAt),
                gaps: typeof finding.gaps === "number" ? finding.gaps : 0,
            },
        ];
    });
}

/**
 * "DC2, 3 findings": what an incident was about, and how much of it there was. Where some
 * of them were never reported, it says so -- "DC2, 1 reported, 1 more seen" --, or the count
 * names findings nobody heard of before.
 */
function incidentText(event: ActivityRecord): string {
    const where = str(event, "dc") ?? str(event, "domain") ?? "the domain";
    const findings = event.data?.findings;
    if (!Array.isArray(findings)) return str(event, "text") ?? where;
    // Explicitly null, not missing: an event that does not say counts as reported.
    const unreported = findings.filter((finding: { reportedAt?: unknown } | null) => finding?.reportedAt === null).length;
    const reported = findings.length - unreported;
    if (event.kind === "domain.issue_resolved" && unreported > 0 && reported > 0) {
        return `${where}, ${reported} reported, ${unreported} more seen`;
    }
    return `${where}, ${findings.length} ${findings.length === 1 ? "finding" : "findings"}`;
}

function afterText(event: ActivityRecord): string {
    const seconds = count(event, "durationSeconds");
    return seconds === null ? "" : ` after ${formatDuration(seconds)}`;
}

export function activityMessage(event: ActivityRecord): string {
    switch (event.kind) {
        case "domain.issue_opened":
            return findingsText(event, "reported") ?? "Something is wrong with the domain";
        case "domain.issue_extended": {
            const text = findingsText(event, "reported");
            return text ? `Also: ${text}` : "Another finding joined";
        }
        case "domain.issue_escalated": {
            const text = findingsText(event, "escalated");
            return text ? `Now an error: ${text}` : "A finding became an error";
        }
        case "domain.issue_resolved":
            return `Resolved${afterText(event)}: ${incidentText(event)}`;
        case "domain.issue_discarded": {
            const after = afterText(event);
            return `Gone before it was reported${after && `,${after}`}: ${incidentText(event)}`;
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
            const attempts = attemptsText(event);
            if (found === null) return `The agent of ${dc(event)} could not fix its database${attempts}`;
            if (found === 0) return `The agent of ${dc(event)} found nothing to fix in its database${attempts}`;
            const fixed = `The agent of ${dc(event)} went at ${errorsText(found)} in its database`;
            if (remaining === null) return `${fixed}; the check after it could not be run${attempts}`;
            return remaining === 0
                ? `${fixed}, and none is left${attempts}`
                : `${fixed}; ${errorsText(remaining)} ${remaining === 1 ? "remains" : "remain"}${attempts}`;
        }
        case "agent.dbcheck_fix_attempted":
            return `Fixing the database of ${dc(event)}, ${attemptOf(event)}: ${fixOutcome(num(event, "errorsFound"), num(event, "errorsRemaining"))}; it is tried again`;
        case "agent.dbcheck_fix_unconfirmed":
            return `The agent of ${dc(event)} has not said how fixing its database went`;
        case "agent.replication_sync_requested": {
            const actor = str(event, "actor");
            return actor ? `${actor} had ${dc(event)} replicate from its partners` : `${dc(event)} was asked to replicate from its partners`;
        }
        // Why it failed, or which links did, is the event's detail.
        case "agent.replication_synced": {
            const links = num(event, "links") ?? 0;
            const failed = num(event, "failed") ?? 0;
            const attempts = attemptsText(event);
            if (links === 0) {
                return str(event, "error") ? `${dc(event)} could not replicate${attempts}` : `${dc(event)} has no partner to replicate from${attempts}`;
            }
            const linksText = `${links} ${links === 1 ? "link" : "links"}`;
            if (failed === 0) return `${dc(event)} replicated from its partners, ${linksText}${attempts}`;
            return `${dc(event)} replicated from its partners; ${failed} of ${linksText} failed${attempts}`;
        }
        case "agent.replication_sync_attempted":
            return `Replicating ${dc(event)} from its partners, ${attemptOf(event)}: ${syncOutcome(num(event, "links") ?? 0, num(event, "failed") ?? 0, str(event, "error"))}; it is tried again`;
        case "agent.replication_sync_unconfirmed":
            return `${dc(event)} has not said how replicating from its partners went`;
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
