import {
    DEFAULT_WEBHOOK_TEMPLATE,
    SAMPLE_WEBHOOK_CLIENT,
    buildWebhookContext,
    renderTemplate,
    sampleWebhookRecord,
    webhookTemplateError,
    type ActivityLevel,
    type Webhook,
    type WebhookInput,
} from "@sadm/shared";
import { DraftFieldError, type FieldErrors, type FieldOf } from "../../../lib/entityForm";

/** The editor's fields, as typed. Headers and kinds are text until they are sent. */
export interface WebhookDraft {
    name: string;
    enabled: boolean;
    url: string;
    method: "POST" | "PUT";
    /** One `Name: value` per line. */
    headers: string;
    bodyTemplate: string;
    minLevel: ActivityLevel;
    /** Comma separated kind patterns. */
    kinds: string;
    timeoutSeconds: string;
}

export const EMPTY_DRAFT: WebhookDraft = {
    name: "",
    enabled: true,
    url: "",
    method: "POST",
    headers: "",
    bodyTemplate: DEFAULT_WEBHOOK_TEMPLATE,
    minLevel: "warning",
    kinds: "",
    timeoutSeconds: "10",
};

export function draftFrom(webhook: Webhook): WebhookDraft {
    return {
        name: webhook.name,
        enabled: webhook.enabled,
        url: webhook.url,
        method: webhook.method,
        headers: Object.entries(webhook.headers)
            .map(([name, value]) => `${name}: ${value}`)
            .join("\n"),
        bodyTemplate: webhook.bodyTemplate,
        minLevel: webhook.minLevel,
        kinds: webhook.kinds.join(", "),
        timeoutSeconds: String(webhook.timeoutMs / 1000),
    };
}

/**
 * The draft as the API takes it. Throws on a header line without a colon or without a name
 * before it -- the one mistake the server could not name, because by then the line would
 * already be gone. Thrown as a `DraftFieldError`, so the form shows it at the headers.
 */
export function inputFrom(draft: WebhookDraft): WebhookInput {
    const headers: Record<string, string> = {};
    draft.headers.split("\n").forEach((line, index) => {
        if (line.trim() === "") return;
        const colon = line.indexOf(":");
        const name = line.slice(0, colon).trim();
        if (colon <= 0 || name === "") {
            throw new DraftFieldError<WebhookDraft>("headers", `Header line ${index + 1} is not "Name: value"`);
        }
        headers[name] = line.slice(colon + 1).trim();
    });
    return {
        name: draft.name,
        enabled: draft.enabled,
        url: draft.url,
        method: draft.method,
        headers,
        bodyTemplate: draft.bodyTemplate,
        minLevel: draft.minLevel,
        kinds: parseKinds(draft.kinds),
        timeoutMs: timeoutMsFrom(draft.timeoutSeconds),
    };
}

/** The timeout field in milliseconds. Empty, or no number at all, is the default of ten seconds. */
export function timeoutMsFrom(seconds: string): number {
    return Math.round((parseFloat(seconds) || 10) * 1000);
}

/**
 * The timeout's range in the unit the field is typed in. The schema refuses the same
 * values, but in milliseconds -- a number the operator never entered.
 */
export function webhookRules(draft: WebhookDraft): FieldErrors<WebhookDraft> {
    const timeoutMs = timeoutMsFrom(draft.timeoutSeconds);
    return timeoutMs < 1000 || timeoutMs > 60000 ? { timeoutSeconds: "Between 1 and 60 seconds." } : {};
}

/** A draft field is named like the request's, except for the timeout and its unit. */
export const webhookFieldOf: FieldOf<WebhookDraft> = (path) => {
    switch (path[0]) {
        case "timeoutMs":
            return "timeoutSeconds";
        case "name":
        case "enabled":
        case "url":
        case "method":
        case "headers":
        case "bodyTemplate":
        case "minLevel":
        case "kinds":
            return path[0];
        default:
            return null;
    }
};

/** The kind patterns of the comma separated field. */
export function parseKinds(text: string): string[] {
    return text
        .split(",")
        .map((kind) => kind.trim())
        .filter((kind) => kind.length > 0);
}

/**
 * The body the sample event would produce, or why there is none. The sample is the one for
 * the webhook's kinds, as the test delivery sends it; `kind` says which it was.
 */
export function previewBody(
    template: string,
    webhookName: string,
    kinds: string,
): { kind: string; body?: string; error?: string } {
    const record = sampleWebhookRecord(parseKinds(kinds));
    const error = webhookTemplateError(template);
    if (error) return { kind: record.kind, error };
    try {
        const context = buildWebhookContext(record, SAMPLE_WEBHOOK_CLIENT, webhookName);
        return { kind: record.kind, body: JSON.stringify(renderTemplate(JSON.parse(template), context), null, 2) };
    } catch (e) {
        return { kind: record.kind, error: (e as Error).message };
    }
}

/** What a template can reach, for the list beside the editor. */
export const PLACEHOLDERS: { path: string; description: string }[] = [
    { path: "event.message", description: "The sentence the dashboard shows" },
    { path: "event.detail", description: "Its second line, such as a priority or an error" },
    { path: "event.kind", description: "domain.issue_opened, directory.user_created, …" },
    { path: "event.level", description: "trace, info, warning or error" },
    { path: "event.occurredAt", description: "When it happened (ISO 8601)" },
    { path: "event.receivedAt", description: "When the server received it" },
    { path: "event.source", description: "agent or server" },
    { path: "event.id", description: "Unique event id" },
    { path: "event.correlationId", description: "Groups events that belong together" },
    { path: "event.subject", description: "instanceName, vrid, interface" },
    { path: "event.data", description: "The event's facts, such as from / to" },
    { path: "client.name", description: "Display name, else hostname" },
    { path: "client.hostname", description: "Hostname the agent reported" },
    { path: "client.site", description: "Site the client belongs to" },
    { path: "client.id", description: "Client id" },
    { path: "webhook.name", description: "This webhook's name" },
];
