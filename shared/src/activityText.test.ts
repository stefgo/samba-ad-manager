import { describe, expect, it } from "vitest";
import { activityDetail, activityMessage, incidentFindings } from "./activityText.js";
import type { ActivityRecord } from "./types.js";

const event = (kind: string, over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id: "e1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    dcId: "d1",
    kind,
    level: "info",
    seen: false,
    ...over,
});

describe("activityMessage: the server's events", () => {
    it("names the domain controller the directory lists, or no longer lists", () => {
        expect(activityMessage(event("dc.discovered", { data: { dcName: "DC2" } }))).toBe(
            "DC2 is a domain controller of this domain",
        );
        expect(activityMessage(event("dc.removed", { subject: { name: "DC2" } }))).toBe(
            "DC2 is no longer a domain controller of this domain",
        );
        expect(activityMessage(event("dc.removed"))).toBe("A domain controller is no longer a domain controller of this domain");
    });

    it("names the scheduler that failed, and why", () => {
        const failed = event("scheduler.failed", { data: { scheduler: "notification-cleanup", error: "disk full" } });
        expect(activityMessage(failed)).toBe("Activity cleanup failed: disk full");
        expect(activityMessage(event("scheduler.failed", { data: { scheduler: "other" } }))).toBe("other failed");
        expect(activityMessage(event("scheduler.failed"))).toBe("A scheduled job failed");
    });

    it("tells an agent that took the place of another from the first one", () => {
        expect(activityMessage(event("agent.registered", { data: { dcName: "DC1" } }))).toBe("An agent registered for DC1");
        expect(activityMessage(event("agent.registered", { data: { dcName: "DC1", reregistered: true } }))).toBe(
            "An agent registered again for DC1",
        );
    });

    it("says who had an agent fix its database, and how that went", () => {
        expect(activityMessage(event("agent.dbcheck_fix_requested", { data: { dcName: "DC1", actor: "admin" } }))).toBe(
            "admin had the agent of DC1 fix the errors of its database check",
        );
        const fixed = (data: Record<string, unknown>) => activityMessage(event("agent.dbcheck_fixed", { data: { dcName: "DC1", ...data } }));
        expect(fixed({ errorsFound: 3, errorsRemaining: 0 })).toBe("The agent of DC1 went at 3 errors in its database, and none is left");
        expect(fixed({ errorsFound: 1, errorsRemaining: 1 })).toBe("The agent of DC1 went at 1 error in its database; 1 error remains");
        expect(fixed({ errorsFound: 2, errorsRemaining: null })).toBe(
            "The agent of DC1 went at 2 errors in its database; the check after it could not be run",
        );
        expect(fixed({ errorsFound: 0, errorsRemaining: 0 })).toBe("The agent of DC1 found nothing to fix in its database");
        expect(fixed({ errorsFound: null, error: "locked" })).toBe("The agent of DC1 could not fix its database");
        expect(fixed({ errorsFound: 2, errorsRemaining: 1, attempts: 3 })).toBe(
            "The agent of DC1 went at 2 errors in its database; 1 error remains (3 attempts)",
        );
        expect(fixed({ errorsFound: null, attempts: 3 })).toBe("The agent of DC1 could not fix its database (3 attempts)");
    });

    it("says how an attempt to fix a database went that is tried again, and that an outcome is late", () => {
        const attempt = (data: Record<string, unknown>) =>
            activityMessage(event("agent.dbcheck_fix_attempted", { data: { dcName: "DC1", attempt: 1, of: 3, ...data } }));
        expect(attempt({ errorsFound: 3, errorsRemaining: 1 })).toBe(
            "Fixing the database of DC1, attempt 1 of 3: went at 3 errors; 1 error remains; it is tried again",
        );
        expect(attempt({ errorsFound: null })).toBe("Fixing the database of DC1, attempt 1 of 3: failed, nothing was changed; it is tried again");
        expect(attempt({ errorsFound: 2, errorsRemaining: null })).toBe(
            "Fixing the database of DC1, attempt 1 of 3: went at 2 errors; the check after it could not be run; it is tried again",
        );
        expect(activityMessage(event("agent.dbcheck_fix_unconfirmed", { data: { dcName: "DC1" } }))).toBe(
            "The agent of DC1 has not said how fixing its database went",
        );
    });

    it("says who had a domain controller replicate, and how that went", () => {
        expect(activityMessage(event("agent.replication_sync_requested", { data: { dcName: "DC1", actor: "admin" } }))).toBe(
            "admin had DC1 replicate from its partners",
        );
        const synced = (data: Record<string, unknown>) => activityMessage(event("agent.replication_synced", { data: { dcName: "DC1", ...data } }));
        expect(synced({ links: 5, failed: 0 })).toBe("DC1 replicated from its partners, 5 links");
        expect(synced({ links: 1, failed: 0 })).toBe("DC1 replicated from its partners, 1 link");
        expect(synced({ links: 5, failed: 2, error: "from DC2: WERR_X" })).toBe("DC1 replicated from its partners; 2 of 5 links failed");
        expect(synced({ links: 0, failed: 0, error: "NT_STATUS_ACCESS_DENIED" })).toBe("DC1 could not replicate");
        expect(synced({ links: 0, failed: 0 })).toBe("DC1 has no partner to replicate from");
        expect(synced({ links: 5, failed: 5, attempts: 3 })).toBe("DC1 replicated from its partners; 5 of 5 links failed (3 attempts)");
    });

    it("says how an attempt to replicate went that is tried again, and that an outcome is late", () => {
        const attempt = (data: Record<string, unknown>) =>
            activityMessage(event("agent.replication_sync_attempted", { data: { dcName: "DC1", attempt: 2, of: 3, ...data } }));
        expect(attempt({ links: 5, failed: 2 })).toBe("Replicating DC1 from its partners, attempt 2 of 3: 2 of 5 links failed; it is tried again");
        expect(attempt({ links: 0, failed: 0 })).toBe(
            "Replicating DC1 from its partners, attempt 2 of 3: no partner to replicate from; it is tried again",
        );
        expect(attempt({ links: 0, failed: 0, error: "refused" })).toBe(
            "Replicating DC1 from its partners, attempt 2 of 3: could not replicate; it is tried again",
        );
        expect(activityMessage(event("agent.replication_sync_unconfirmed", { data: { dcName: "DC1" } }))).toBe(
            "DC1 has not said how replicating from its partners went",
        );
    });

    it("prints the kind of an event it cannot phrase", () => {
        expect(activityMessage(event("future.kind"))).toBe("future.kind");
    });
});

describe("activityDetail", () => {
    it("is the error an event carries, or nothing", () => {
        expect(activityDetail(event("scheduler.failed", { data: { error: "disk full" } }))).toBe("disk full");
        expect(activityDetail(event("dc.discovered"))).toBeNull();
    });
});

describe("activityMessage: changes to the directory", () => {
    const change = (kind: string, data: Record<string, unknown> = {}) =>
        event(kind, {
            subject: { dn: "CN=Jane Doe,OU=Staff,DC=sadm,DC=test", name: "jdoe" },
            data: { actor: "admin", name: "jdoe", type: "user", ...data },
        });

    it("says who did what to which object", () => {
        expect(activityMessage(change("directory.user_created"))).toBe("admin created user jdoe");
        expect(activityMessage(change("directory.user_updated"))).toBe("admin changed user jdoe");
        expect(activityMessage(change("directory.password_set"))).toBe("admin set the password of user jdoe");
        expect(activityMessage(change("directory.account_disabled"))).toBe("admin disabled user jdoe");
        expect(activityMessage(change("directory.object_deleted", { type: "ou", name: "Staff" }))).toBe(
            "admin deleted organizational unit Staff",
        );
    });

    it("says which DNS record, under which name, and what it said before a change", () => {
        const record = (kind: string, data: Record<string, unknown> = {}) =>
            change(kind, { type: "dns-record", name: "www.sadm.test", record: "A 192.0.2.11", ...data });
        expect(activityMessage(record("directory.dns_record_created"))).toBe("admin created DNS record www.sadm.test A 192.0.2.11");
        expect(activityMessage(record("directory.dns_record_updated", { was: "A 192.0.2.10" }))).toBe(
            "admin changed DNS record www.sadm.test A 192.0.2.11 (was A 192.0.2.10)",
        );
        expect(activityMessage(record("directory.dns_record_deleted"))).toBe("admin deleted DNS record www.sadm.test A 192.0.2.11");
    });

    it("says how many members, and where to or what to", () => {
        expect(activityMessage(change("directory.members_added", { type: "group", name: "staff", members: 1 }))).toBe(
            "admin added 1 member to group staff",
        );
        expect(activityMessage(change("directory.members_removed", { type: "group", name: "staff", members: 3 }))).toBe(
            "admin removed 3 members from group staff",
        );
        expect(activityMessage(change("directory.object_moved", { target: "OU=Sales,DC=sadm,DC=test" }))).toBe(
            "admin moved user jdoe to OU=Sales,DC=sadm,DC=test",
        );
        expect(activityMessage(change("directory.object_renamed", { newName: "Jane Roe" }))).toBe(
            "admin renamed user jdoe to Jane Roe",
        );
    });

    it("gets by without the facts an older server left out", () => {
        expect(activityMessage(event("directory.user_created"))).toBe("Somebody created object ?");
    });

    it("has the object's DN as its detail", () => {
        expect(activityDetail(change("directory.user_created"))).toBe("CN=Jane Doe,OU=Staff,DC=sadm,DC=test");
    });
});

describe("activityMessage: incidents of the domain", () => {
    const exited = { text: "DC2: the Samba container is exited" };
    const kerberos = { text: "DC2: Kerberos (port 88) does not answer" };
    const incident = (kind: string, data: Record<string, unknown> = {}) =>
        event(kind, { data: { dc: "DC2", domain: "sadm.test", findings: [exited, kerberos], ...data } });

    it("is the finding that was reported, and how many more were", () => {
        expect(activityMessage(incident("domain.issue_opened", { reported: [exited] }))).toBe("DC2: the Samba container is exited");
        expect(activityMessage(incident("domain.issue_opened", { reported: [exited, kerberos] }))).toBe(
            "DC2: the Samba container is exited and 1 more",
        );
    });

    it("names a finding that joined", () => {
        expect(activityMessage(incident("domain.issue_extended", { reported: [kerberos] }))).toBe(
            "Also: DC2: Kerberos (port 88) does not answer",
        );
    });

    it("says that a finding became an error", () => {
        expect(activityMessage(incident("domain.issue_escalated", { escalated: [exited] }))).toBe(
            "Now an error: DC2: the Samba container is exited",
        );
    });

    it("says that it went, after how long, and how much there was", () => {
        expect(activityMessage(incident("domain.issue_resolved", { durationSeconds: 184 }))).toBe("Resolved after 3 min: DC2, 2 findings");
        expect(activityMessage(incident("domain.issue_resolved", { dc: null, findings: [exited] }))).toBe("Resolved: sadm.test, 1 finding");
    });

    it("tells the findings that were reported from those only seen", () => {
        const reported = { ...exited, reportedAt: "2026-01-01T00:05:00.000Z" };
        const seen = { ...kerberos, reportedAt: null };
        expect(activityMessage(incident("domain.issue_resolved", { durationSeconds: 900, findings: [reported, seen] }))).toBe(
            "Resolved after 15 min: DC2, 1 reported, 1 more seen",
        );
        expect(activityMessage(incident("domain.issue_resolved", { findings: [reported, { ...seen, reportedAt: "x" }] }))).toBe(
            "Resolved: DC2, 2 findings",
        );
    });

    it("says that it was over before it was reported", () => {
        expect(activityMessage(incident("domain.issue_discarded", { durationSeconds: 70 }))).toBe(
            "Gone before it was reported, after 1 min: DC2, 2 findings",
        );
    });

    it("reads an event stored before incidents by its one finding", () => {
        const before = (kind: string, data: Record<string, unknown> = {}) => event(kind, { data: { ...exited, ...data } });
        expect(activityMessage(before("domain.issue_opened"))).toBe("DC2: the Samba container is exited");
        expect(activityMessage(before("domain.issue_resolved", { durationSeconds: 184 }))).toBe(
            "Resolved after 3 min: DC2: the Samba container is exited",
        );
    });

    it("lists the findings of the incident, reported or not", () => {
        const full = {
            ...exited,
            type: "dc-unreachable",
            severity: "warning",
            worstSeverity: "error",
            state: "gone",
            since: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-01T00:10:00.000Z",
            reportedAt: "2026-01-01T00:05:00.000Z",
            gaps: 2,
        };
        expect(incidentFindings(incident("domain.issue_resolved", { findings: [full, { ...kerberos, reportedAt: null }] }))).toEqual([
            {
                text: exited.text,
                worstSeverity: "error",
                reportedAt: "2026-01-01T00:05:00.000Z",
                since: "2026-01-01T00:00:00.000Z",
                lastSeenAt: "2026-01-01T00:10:00.000Z",
                gaps: 2,
            },
            { text: kerberos.text, worstSeverity: null, reportedAt: null, since: null, lastSeenAt: null, gaps: 0 },
        ]);
    });

    it("lists no findings for an event that has none", () => {
        expect(incidentFindings(incident("domain.issue_opened", { findings: [{ text: "" }, null] }))).toEqual([]);
        expect(incidentFindings(event("domain.issue_resolved", { data: { ...exited } }))).toBeNull();
        expect(incidentFindings(event("directory.user_created", { data: { findings: [exited] } }))).toBeNull();
    });

    it("gets by without facts", () => {
        expect(activityMessage(event("domain.issue_opened"))).toBe("Something is wrong with the domain");
        expect(activityMessage(event("domain.issue_extended"))).toBe("Another finding joined");
        expect(activityMessage(event("domain.issue_escalated"))).toBe("A finding became an error");
        expect(activityMessage(event("domain.issue_resolved"))).toBe("Resolved: the domain");
    });
});
