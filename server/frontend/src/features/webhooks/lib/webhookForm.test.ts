import { describe, expect, it } from "vitest";
import {
    DEFAULT_WEBHOOK_TEMPLATE,
    WEBHOOK_TEMPLATE_ROOTS,
    WebhookInputSchema,
    webhookTemplateError,
    type Webhook,
} from "@sadm/shared";
import {
    EMPTY_DRAFT,
    PLACEHOLDERS,
    draftFrom,
    inputFrom,
    parseKinds,
    previewBody,
    webhookFieldOf,
    webhookRules,
    type WebhookDraft,
} from "./webhookForm";
import { checkDraft } from "../../../lib/entityForm";

const draft = (changes: Partial<WebhookDraft> = {}): WebhookDraft => ({
    ...EMPTY_DRAFT,
    name: "Chat",
    url: "https://chat.example.org/hook",
    ...changes,
});

const webhook = (changes: Partial<Webhook> = {}): Webhook => ({
    id: "w1",
    name: "Chat",
    enabled: true,
    url: "https://chat.example.org/hook",
    method: "POST",
    headers: {},
    bodyTemplate: DEFAULT_WEBHOOK_TEMPLATE,
    minLevel: "warning",
    kinds: [],
    timeoutMs: 10000,
    lastStatus: null,
    lastError: null,
    lastAttemptAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: null,
    ...changes,
});

describe("parseKinds", () => {
    it("splits at commas and trims", () => {
        expect(parseKinds("scheduler.failed,  client.* ")).toEqual(["scheduler.failed", "client.*"]);
    });

    it("drops empty entries", () => {
        expect(parseKinds("")).toEqual([]);
        expect(parseKinds(" , client.*,, ")).toEqual(["client.*"]);
    });
});

describe("inputFrom", () => {
    it("passes the plain fields through", () => {
        expect(inputFrom(draft({ enabled: false, method: "PUT", minLevel: "error" }))).toMatchObject({
            name: "Chat",
            enabled: false,
            url: "https://chat.example.org/hook",
            method: "PUT",
            bodyTemplate: DEFAULT_WEBHOOK_TEMPLATE,
            minLevel: "error",
        });
    });

    it("reads one header per line, skipping blank ones", () => {
        const headers = "Authorization: Bearer abc\n\n  X-Site :  dc1  \n";
        expect(inputFrom(draft({ headers })).headers).toEqual({ Authorization: "Bearer abc", "X-Site": "dc1" });
    });

    it("cuts a header at its first colon only", () => {
        expect(inputFrom(draft({ headers: "X-Target: https://example.org:8443/a" })).headers).toEqual({
            "X-Target": "https://example.org:8443/a",
        });
    });

    it("names the line of a header without a name or a colon", () => {
        expect(() => inputFrom(draft({ headers: "X-A: 1\nno colon here" }))).toThrow(
            'Header line 2 is not "Name: value"',
        );
        expect(() => inputFrom(draft({ headers: ": value" }))).toThrow('Header line 1 is not "Name: value"');
    });

    it("splits the kinds", () => {
        expect(inputFrom(draft({ kinds: "client.*, scheduler.failed" })).kinds).toEqual([
            "client.*",
            "scheduler.failed",
        ]);
    });

    it("sends the timeout in milliseconds, and ten seconds for what is no number", () => {
        const timeout = (timeoutSeconds: string) => inputFrom(draft({ timeoutSeconds })).timeoutMs;
        expect(timeout("5")).toBe(5000);
        expect(timeout("2.5")).toBe(2500);
        expect(timeout("")).toBe(10000);
        expect(timeout("soon")).toBe(10000);
        expect(timeout("0")).toBe(10000);
    });

    it("turns the draft a new webhook starts with into something the server accepts", () => {
        expect(WebhookInputSchema.safeParse(inputFrom(draft())).success).toBe(true);
    });
});

describe("the webhook form's verdict", () => {
    const check = (d: WebhookDraft) =>
        checkDraft({ schema: WebhookInputSchema, toInput: inputFrom, fieldOf: webhookFieldOf, rules: webhookRules }, d);

    it("accepts the draft a new webhook starts with, once it has a name and a URL", () => {
        expect(check(draft())).toMatchObject({ isValid: true, errors: {} });
    });

    it("reports a missing name and a URL without a scheme at their fields", () => {
        const { errors, isValid } = check(draft({ name: "", url: "chat.example.org" }));
        expect(errors.name).toBe("A name is required");
        expect(errors.url).toBe("Must be an http:// or https:// URL");
        expect(isValid).toBe(false);
    });

    it("reports a broken header line at the headers, without a request to send", () => {
        const verdict = check(draft({ headers: "no colon here" }));
        expect(verdict.errors.headers).toBe('Header line 1 is not "Name: value"');
        expect(verdict.input).toBeNull();
    });

    it("reports a header name the server refuses at the headers", () => {
        expect(check(draft({ headers: "Bad Name: 1" })).errors.headers).toBe("Not a valid header name");
    });

    it("states the timeout's range in seconds, the unit of the field", () => {
        expect(check(draft({ timeoutSeconds: "0.5" })).errors.timeoutSeconds).toBe("Between 1 and 60 seconds.");
        expect(check(draft({ timeoutSeconds: "61" })).errors.timeoutSeconds).toBe("Between 1 and 60 seconds.");
        expect(check(draft({ timeoutSeconds: "60" })).isValid).toBe(true);
    });

    it("reports a template that is no JSON at the template", () => {
        expect(check(draft({ bodyTemplate: "{" })).errors.bodyTemplate).toBeDefined();
    });
});

describe("draftFrom", () => {
    it("writes headers, kinds and the timeout as the editor shows them", () => {
        const stored = webhook({
            headers: { Authorization: "Bearer abc", "X-Site": "dc1" },
            kinds: ["client.*", "scheduler.failed"],
            timeoutMs: 2500,
        });
        expect(draftFrom(stored)).toMatchObject({
            headers: "Authorization: Bearer abc\nX-Site: dc1",
            kinds: "client.*, scheduler.failed",
            timeoutSeconds: "2.5",
        });
    });

    it("comes back as the same input after a round trip", () => {
        const stored = webhook({
            enabled: false,
            method: "PUT",
            headers: { Authorization: "Bearer abc" },
            minLevel: "error",
            kinds: ["client.*"],
            timeoutMs: 30000,
        });
        const { name, enabled, url, method, headers, bodyTemplate, minLevel, kinds, timeoutMs } = stored;
        expect(inputFrom(draftFrom(stored))).toEqual({
            name,
            enabled,
            url,
            method,
            headers,
            bodyTemplate,
            minLevel,
            kinds,
            timeoutMs,
        });
    });
});

describe("previewBody", () => {
    it("renders the sample for the webhook's kinds, and says which it was", () => {
        const preview = previewBody('{"text": "{{webhook.name}}: {{event.message}}"}', "Chat", "scheduler.*");
        expect(preview).toEqual({
            kind: "scheduler.failed",
            body: JSON.stringify({ text: "Chat: Token cleanup failed: database is locked" }, null, 2),
        });
    });

    it("previews the first sample where no kind is named", () => {
        const preview = previewBody('"{{event.kind}} on {{client.name}}"', "Chat", "");
        expect(preview).toEqual({ kind: "client.disconnected", body: '"client.disconnected on dc1"' });
    });

    it("gives the reason instead of a body for a template that cannot be used", () => {
        expect(previewBody("{", "Chat", "")).toMatchObject({ kind: "client.disconnected" });
        expect(previewBody("{", "Chat", "").error).toMatch(/^Not valid JSON: /);
        expect(previewBody('"{{nope}}"', "Chat", "client.reg*")).toEqual({
            kind: "client.registered",
            error: '"{{nope}}": a path starts with event, client, webhook',
        });
    });

    it("renders the template a new webhook starts with", () => {
        const preview = previewBody(EMPTY_DRAFT.bodyTemplate, "Chat", "");
        expect(preview.error).toBeUndefined();
        expect(JSON.parse(preview.body ?? "null")).toMatchObject({
            text: "[trace] dc1: dc1 disconnected",
            kind: "client.disconnected",
        });
    });
});

describe("PLACEHOLDERS", () => {
    it("lists only what a template can use", () => {
        for (const { path } of PLACEHOLDERS) {
            expect(webhookTemplateError(JSON.stringify(`{{${path}}}`)), path).toBeNull();
        }
    });

    it("names every root at least once, and no path twice", () => {
        const paths = PLACEHOLDERS.map((placeholder) => placeholder.path);
        expect(new Set(paths).size).toBe(paths.length);
        expect([...new Set(paths.map((path) => path.split(".")[0]))].sort()).toEqual([...WEBHOOK_TEMPLATE_ROOTS].sort());
    });
});
