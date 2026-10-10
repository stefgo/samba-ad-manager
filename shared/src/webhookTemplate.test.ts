import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "./types.js";
import {
    DEFAULT_WEBHOOK_TEMPLATE,
    SAMPLE_WEBHOOK_CLIENT,
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
    receivedAt: "2026-01-01T00:00:01.000Z",
    source: "server",
    clientId: "c1",
    kind: "scheduler.failed",
    level: "error",
    seen: false,
    subject: null,
    data: { scheduler: "token-cleanup", error: "disk full" },
    ...over,
});

const CLIENT = { id: "c1", displayName: "dc1", hostname: "dc1.example.net", site: "hq" };

const context = (over: Partial<ActivityRecord> = {}): WebhookContext =>
    buildWebhookContext(record(over), CLIENT, "Chat");

describe("the roots of a webhook template", () => {
    // The grammar is tested where it lives, in @stefgo/js-template-engine. What is decided
    // here is what a path may start with.
    it("reads the event, the client and the webhook", () => {
        expect(webhookTemplateError('{"text": "{{event.kind}} {{client.name}} {{webhook.name}}"}')).toBeNull();
        expect(placeholderError(["https://example.org/{{client.id}}", "Bearer {{webhook.name}}"])).toBeNull();
    });

    it("has nothing to say about the template a new webhook starts with", () => {
        expect(webhookTemplateError(DEFAULT_WEBHOOK_TEMPLATE)).toBeNull();
    });

    it("refuses a path that starts with anything else", () => {
        expect(webhookTemplateError('{"text": "{{host.name}}"}')).toBe(
            'text: "{{host.name}}": a path starts with event, client, webhook',
        );
        expect(placeholderError("{{host.name}}")).toBe('"{{host.name}}": a path starts with event, client, webhook');
    });
});

describe("buildWebhookContext", () => {
    it("carries the event with the sentence the dashboard shows", () => {
        expect(context().event).toMatchObject({
            id: "e1",
            kind: "scheduler.failed",
            level: "error",
            correlationId: null,
            message: "Token cleanup failed: disk full",
            detail: "disk full",
        });
    });

    it("names the client by its display name, then its hostname, then its id", () => {
        const name = (displayName: string | null, hostname: string | null) =>
            buildWebhookContext(record(), { ...CLIENT, displayName, hostname }, "Chat").client?.name;
        expect(name("dc1", "dc1.example.net")).toBe("dc1");
        expect(name("", "dc1.example.net")).toBe("dc1.example.net");
        expect(name(null, null)).toBe("c1");
    });

    it("has no client for an event the server reported about itself", () => {
        expect(buildWebhookContext(record(), null, "Chat").client).toBeNull();
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
        const filter = { minLevel: "trace" as const, kinds: ["client.*", "scheduler.failed"] };
        expect(webhookAccepts(filter, { kind: "client.registered", level: "info" })).toBe(true);
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
        expect(sampleWebhookRecord(["future.*", "client.registered"]).kind).toBe("client.registered");
    });

    it("is the opening for the findings of the domain", () => {
        expect(sampleWebhookRecord(["domain.*"]).kind).toBe("domain.issue_opened");
        expect(sampleWebhookRecord(["domain.issue_resolved"]).data).toMatchObject({ durationSeconds: 184 });
    });

    it("renders with the default template", () => {
        const sample = sampleWebhookRecord(["scheduler.failed"]);
        const body = renderTemplate(
            JSON.parse(DEFAULT_WEBHOOK_TEMPLATE),
            buildWebhookContext(sample, SAMPLE_WEBHOOK_CLIENT, "Chat"),
        );
        expect(body).toMatchObject({
            text: "[error] dc1: Token cleanup failed: database is locked",
            kind: "scheduler.failed",
            data: { scheduler: "token-cleanup", error: "database is locked" },
        });
    });
});
