import { createTemplateEngine, matchesKindPattern } from "@stefgo/js-template-engine";
import { ACTIVITY_LEVELS } from "./constants.js";
import { activityDetail, activityMessage } from "./activityText.js";
import type { ActivityLevel, ActivityRecord } from "./types.js";

export { matchesKindPattern };

/**
 * The JSON a webhook sends, written by the operator.
 *
 * The language is the one of `@stefgo/js-template-engine`: `{{path}}` placeholders, filters,
 * `$if`, `$map` and `$join`, filled in on the parsed tree, so what an event carries cannot
 * break the JSON or smuggle in keys of its own. Its README describes the grammar. What is
 * decided here is the context -- what a template can read -- and which events a webhook takes.
 *
 * The engine is free of Node, so the settings page previews a template with the same code the
 * server sends it with -- a preview that rendered differently would be worse than none.
 */

/** What a placeholder may start with. Anything else is a typo, and is refused on save. */
export const WEBHOOK_TEMPLATE_ROOTS = ["event", "dc", "webhook"] as const;

export interface WebhookContext {
    event: {
        id: string;
        kind: string;
        level: ActivityLevel;
        occurredAt: string;
        correlationId: string | null;
        subject: Record<string, unknown> | null;
        data: Record<string, unknown> | null;
        /** The sentence the dashboard shows for the event. */
        message: string;
        /** The dashboard's second line, where there is one. */
        detail: string | null;
    };
    /** The domain controller the event is about; null for one about the domain or the server. */
    dc: WebhookDcInfo | null;
    webhook: {
        name: string;
    };
}

/** The part of a domain controller a template can see. */
export interface WebhookDcInfo {
    id: string;
    name: string;
    dnsHostName: string | null;
    site: string | null;
}

export function buildWebhookContext(
    record: ActivityRecord,
    dc: WebhookDcInfo | null,
    webhookName: string,
): WebhookContext {
    return {
        event: {
            id: record.id,
            kind: record.kind,
            level: record.level,
            occurredAt: record.occurredAt,
            correlationId: record.correlationId ?? null,
            subject: record.subject ?? null,
            data: record.data ?? null,
            message: activityMessage(record),
            detail: activityDetail(record),
        },
        dc: dc ? { id: dc.id, name: dc.name, dnsHostName: dc.dnsHostName, site: dc.site } : null,
        webhook: { name: webhookName },
    };
}

// ── Engine ───────────────────────────────────────────────────────────────────

const engine = createTemplateEngine({ roots: WEBHOOK_TEMPLATE_ROOTS });

/** Fills the placeholders of a string as text: for a URL or a header. */
export function renderTemplateText(text: string, context: WebhookContext): string {
    return engine.renderTemplateText(text, context);
}

/** Fills a parsed template. Throws on a template that does not compile. */
export function renderTemplate(template: unknown, context: WebhookContext): unknown {
    return engine.renderTemplate(template, context);
}

/**
 * Why a body template cannot be used, or null. Checked on save, so a broken template is
 * refused in the editor instead of failing on the first event, when nobody is looking.
 */
export function webhookTemplateError(source: string): string | null {
    return engine.templateError(source);
}

/** Why strings with placeholders -- a URL, header values -- cannot be used, or null. */
export function placeholderError(node: unknown): string | null {
    return engine.placeholderError(node);
}

// ── Filters ──────────────────────────────────────────────────────────────────

/** Whether an event passes a webhook's filters: its level at least, and one of its kinds. */
export function webhookAccepts(
    filter: { minLevel: ActivityLevel; kinds: string[] },
    record: Pick<ActivityRecord, "kind" | "level">,
): boolean {
    if (ACTIVITY_LEVELS.indexOf(record.level) < ACTIVITY_LEVELS.indexOf(filter.minLevel)) {
        return false;
    }
    return filter.kinds.length === 0 || filter.kinds.some((p) => matchesKindPattern(record.kind, p));
}

// ── Sample ───────────────────────────────────────────────────────────────────

type SampleFacts = Pick<ActivityRecord, "kind" | "level" | "subject" | "data"> &
    Partial<Pick<ActivityRecord, "correlationId">>;

/** One per shape of `data`, so a preview can show what the webhook will receive. */
const SAMPLES: SampleFacts[] = [
    {
        kind: "domain.issue_opened",
        level: "error",
        correlationId: "11111111-1111-4111-8111-111111111111",
        subject: { name: "DC2" },
        data: {
            type: "service-down",
            severity: "error",
            dc: "DC2",
            text: "DC2: Kerberos (port 88) does not answer: timed out",
            domain: "sadm.test",
            status: "critical",
        },
    },
    {
        kind: "domain.issue_resolved",
        level: "info",
        correlationId: "11111111-1111-4111-8111-111111111111",
        subject: { name: "DC2" },
        data: {
            type: "service-down",
            severity: "error",
            dc: "DC2",
            text: "DC2: Kerberos (port 88) does not answer: timed out",
            domain: "sadm.test",
            status: "healthy",
            durationSeconds: 184,
        },
    },
    {
        kind: "directory.user_created",
        level: "info",
        subject: { dn: "CN=Jane Doe,OU=Staff,DC=sadm,DC=test", name: "jdoe" },
        data: { actor: "admin", name: "jdoe", type: "user", dcName: "DC1" },
    },
    {
        kind: "dc.discovered",
        level: "info",
        subject: { name: "DC3" },
        data: { dcName: "DC3", dnsHostName: "dc3.example.net", site: "Default-First-Site-Name" },
    },
    {
        kind: "scheduler.failed",
        level: "error",
        subject: null,
        data: { scheduler: "notification-cleanup", error: "database is locked" },
    },
];

/**
 * The event a preview and a test delivery are rendered with: the first sample one of the
 * webhook's kinds matches, else the first one.
 */
export function sampleWebhookRecord(kinds: string[] = []): ActivityRecord {
    const now = new Date().toISOString();
    const sample =
        SAMPLES.find((s) => kinds.some((pattern) => matchesKindPattern(s.kind, pattern))) ?? SAMPLES[0];
    return {
        id: "00000000-0000-4000-8000-000000000000",
        occurredAt: now,
        dcId: SAMPLE_WEBHOOK_DC.id,
        correlationId: null,
        seen: false,
        ...sample,
    };
}

export const SAMPLE_WEBHOOK_DC: WebhookDcInfo = {
    id: "11111111-2222-4333-8444-555555555555",
    name: "DC1",
    dnsHostName: "dc1.example.net",
    site: "Default-First-Site-Name",
};

/** What a new webhook starts with: small, but using each part of the context once. */
export const DEFAULT_WEBHOOK_TEMPLATE = `{
    "text": "[{{event.level}}] {{dc.name | default(\\"domain\\")}}: {{event.message}}",
    "kind": "{{event.kind}}",
    "occurredAt": "{{event.occurredAt}}",
    "subject": "{{event.subject}}",
    "data": "{{event.data}}"
}`;
