import { describe, expect, it } from "vitest";
import { activityDetail, activityMessage } from "./activityText.js";
import type { ActivityRecord } from "./types.js";

const event = (kind: string, over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id: "e1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    source: "server",
    clientId: "c1",
    kind,
    level: "info",
    seen: false,
    ...over,
});

describe("activityMessage: the server's events", () => {
    it("names the client that connected or went away", () => {
        expect(activityMessage(event("client.connected", { data: { clientName: "dc1" } }))).toBe("dc1 connected");
        expect(activityMessage(event("client.disconnected", { data: { clientName: "dc1" } }))).toBe(
            "dc1 disconnected",
        );
        expect(activityMessage(event("client.connected"))).toBe("the client connected");
    });

    it("names a registration by the hostname the agent gave", () => {
        expect(activityMessage(event("client.registered", { data: { hostname: "dc2.example.net" } }))).toBe(
            "dc2.example.net registered",
        );
    });

    it("names the scheduler that failed, and why", () => {
        const failed = event("scheduler.failed", { data: { scheduler: "token-cleanup", error: "disk full" } });
        expect(activityMessage(failed)).toBe("Token cleanup failed: disk full");
        expect(activityMessage(event("scheduler.failed", { data: { scheduler: "other" } }))).toBe("other failed");
        expect(activityMessage(event("scheduler.failed"))).toBe("A scheduled job failed");
    });

    it("prints the kind of an event it cannot phrase", () => {
        expect(activityMessage(event("future.kind"))).toBe("future.kind");
    });
});

describe("activityDetail", () => {
    it("is the error an event carries, or nothing", () => {
        expect(activityDetail(event("scheduler.failed", { data: { error: "disk full" } }))).toBe("disk full");
        expect(activityDetail(event("client.connected"))).toBeNull();
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

describe("activityMessage: findings about the domain", () => {
    const finding = (kind: string, data: Record<string, unknown> = {}) =>
        event(kind, { data: { text: "DC2: the Samba container is exited", ...data } });

    it("is the finding itself when it appears", () => {
        expect(activityMessage(finding("domain.issue_opened"))).toBe("DC2: the Samba container is exited");
    });

    it("says that it went, and after how long", () => {
        expect(activityMessage(finding("domain.issue_resolved", { durationSeconds: 184 }))).toBe(
            "Resolved after 3 min: DC2: the Samba container is exited",
        );
        expect(activityMessage(finding("domain.issue_resolved"))).toBe("Resolved: DC2: the Samba container is exited");
    });

    it("gets by without a text", () => {
        expect(activityMessage(event("domain.issue_opened"))).toBe("Something is wrong with the domain");
        expect(activityMessage(event("domain.issue_resolved"))).toBe("A finding was resolved");
    });
});
