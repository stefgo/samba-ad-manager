import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "./types.js";
import {
    DEFAULT_WEBHOOK_TEMPLATE,
    SAMPLE_WEBHOOK_DC,
    buildWebhookContext,
    placeholderError,
    renderTemplate,
    sampleWebhookRecord,
    webhookAccepts,
    webhookTemplateError,
    type WebhookContext,
} from "./webhookTemplate.js";

const record = (over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id: "e1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    dcId: "d1",
    kind: "scheduler.failed",
    level: "error",
    seen: false,
    subject: null,
    data: { scheduler: "notification-cleanup", error: "disk full" },
    ...over,
});

const DC = { id: "d1", name: "DC1", dnsHostName: "dc1.example.net", site: "hq" };

const context = (over: Partial<ActivityRecord> = {}): WebhookContext =>
    buildWebhookContext(record(over), DC, "Chat");

describe("the roots of a webhook template", () => {
    // The grammar is tested where it lives, in @stefgo/js-template-engine. What is decided
    // here is what a path may start with.
    it("reads the event, the domain controller and the webhook", () => {
        expect(webhookTemplateError('{"text": "{{event.kind}} {{dc.name}} {{webhook.name}}"}')).toBeNull();
        expect(placeholderError(["https://example.org/{{dc.id}}", "Bearer {{webhook.name}}"])).toBeNull();
    });

    it("has nothing to say about the template a new webhook starts with", () => {
        expect(webhookTemplateError(DEFAULT_WEBHOOK_TEMPLATE)).toBeNull();
    });

    it("refuses a path that starts with anything else", () => {
        expect(webhookTemplateError('{"text": "{{host.name}}"}')).toBe(
            'text: "{{host.name}}": a path starts with event, dc, webhook',
        );
        expect(placeholderError("{{host.name}}")).toBe('"{{host.name}}": a path starts with event, dc, webhook');
    });
});

describe("buildWebhookContext", () => {
    it("carries the event with the sentence the dashboard shows", () => {
        expect(context().event).toMatchObject({
            id: "e1",
            kind: "scheduler.failed",
            level: "error",
            correlationId: null,
            message: "Activity cleanup failed: disk full",
            detail: "disk full",
        });
    });

    it("names the domain controller the event is about", () => {
        expect(context().dc).toEqual(DC);
    });

    it("has no domain controller for an event about the domain or the server", () => {
        expect(buildWebhookContext(record(), null, "Chat").dc).toBeNull();
    });
});

describe("webhookAccepts", () => {
    it("wants the level at least", () => {
        const filter = { minLevel: "warning" as const, kinds: [] };
        expect(webhookAccepts(filter, { kind: "x", level: "info" })).toBe(false);
        expect(webhookAccepts(filter, { kind: "x", level: "warning" })).toBe(true);
        expect(webhookAccepts(filter, { kind: "x", level: "error" })).toBe(true);
    });

    it("wants one of the kinds, or any kind where none is named", () => {
        const filter = { minLevel: "trace" as const, kinds: ["dc.*", "scheduler.failed"] };
        expect(webhookAccepts(filter, { kind: "dc.discovered", level: "info" })).toBe(true);
        expect(webhookAccepts(filter, { kind: "scheduler.failed", level: "info" })).toBe(true);
        expect(webhookAccepts(filter, { kind: "scheduler.started", level: "info" })).toBe(false);
    });
});

describe("sampleWebhookRecord", () => {
    it("is the first sample unless the kinds say otherwise", () => {
        expect(sampleWebhookRecord().kind).toBe("domain.issue_opened");
        expect(sampleWebhookRecord(["future.*"]).kind).toBe("domain.issue_opened");
    });

    it("is the first sample one of the kinds matches", () => {
        expect(sampleWebhookRecord(["scheduler.*"]).kind).toBe("scheduler.failed");
        expect(sampleWebhookRecord(["future.*", "dc.discovered"]).kind).toBe("dc.discovered");
    });

    it("is the opening for the incidents of the domain, and each kind of them where it is named", () => {
        expect(sampleWebhookRecord(["domain.*"]).kind).toBe("domain.issue_opened");
        for (const kind of ["domain.issue_extended", "domain.issue_escalated", "domain.issue_resolved", "domain.issue_discarded"]) {
            expect(sampleWebhookRecord([kind]).kind).toBe(kind);
        }
        expect(sampleWebhookRecord(["domain.issue_resolved"]).data).toMatchObject({ durationSeconds: 1260 });
        expect(sampleWebhookRecord(["domain.issue_discarded"]).correlationId).toBeNull();
    });

    it("lists the findings of an incident through a loop", () => {
        const template = {
            text: { $join: { $map: "event.data.findings", "each(f)": "- {{f.text}} ({{f.gaps}} gaps)" }, with: "\n" },
        };
        const body = renderTemplate(template, buildWebhookContext(sampleWebhookRecord(["domain.issue_resolved"]), SAMPLE_WEBHOOK_DC, "Chat"));
        expect(body).toEqual({
            text:
                "- DC2: Kerberos (port 88) does not answer: timed out (1 gaps)\n" +
                "- DC2: LDAP (port 636) does not answer: connection refused (0 gaps)",
        });
    });

    it("renders with the default template", () => {
        const sample = sampleWebhookRecord(["scheduler.failed"]);
        const body = renderTemplate(
            JSON.parse(DEFAULT_WEBHOOK_TEMPLATE),
            buildWebhookContext(sample, SAMPLE_WEBHOOK_DC, "Chat"),
        );
        expect(body).toMatchObject({
            text: "[error] DC1: Activity cleanup failed: database is locked",
            kind: "scheduler.failed",
            data: { scheduler: "notification-cleanup", error: "database is locked" },
        });
    });
});
