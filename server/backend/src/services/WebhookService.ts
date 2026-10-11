import {
    SAMPLE_WEBHOOK_DC,
    buildWebhookContext,
    renderTemplate,
    renderTemplateText,
    sampleWebhookRecord,
    webhookAccepts,
    type ActivityRecord,
    type Webhook,
    type WebhookDcInfo,
    type WebhookTestResult,
} from "@sadm/shared";
import { logger } from "../core/logger.js";
import { DomainControllerRepository } from "../repositories/DomainControllerRepository.js";
import { WebhookRepository, type WebhookFields } from "../repositories/WebhookRepository.js";

/** The waits before the second and the third attempt. */
const RETRY_DELAYS_MS = [1_000, 5_000];

/** How much of a target's answer is kept, for the editor to show why it refused. */
const RESPONSE_PREVIEW_CHARS = 500;

/**
 * Deliveries one webhook may have waiting. A target that hangs for its whole timeout on
 * every attempt falls behind a burst of events; past this, new ones are dropped with a log
 * line instead of piling up in memory for as long as the target is down.
 */
const MAX_PENDING_PER_WEBHOOK = 100;

interface Delivery {
    status: number | null;
    error: string | null;
    response: string | null;
}

/** Deliveries per webhook run one after another, so a target sees events in their order. */
const queues = new Map<string, { tail: Promise<void>; pending: number }>();

/** The domain controller an event is about, for the template. One the directory no longer lists keeps the name the event gave it. */
function dcInfo(record: ActivityRecord): WebhookDcInfo | null {
    if (!record.dcId) return null;
    const row = DomainControllerRepository.findById(record.dcId);
    if (!row) return { id: record.dcId, name: record.subject?.name ?? record.dcId, dnsHostName: null, site: null };
    return { id: row.id, name: row.name, dnsHostName: row.dns_host_name, site: row.site };
}

/** Renders one delivery. Throws on a template that does not parse -- the save should have caught it. */
function render(
    webhook: WebhookFields,
    record: ActivityRecord,
    dc: WebhookDcInfo | null,
): { url: string; headers: Record<string, string>; body: unknown } {
    const context = buildWebhookContext(record, dc, webhook.name);
    const headers: Record<string, string> = { "content-type": "application/json" };
    for (const [name, value] of Object.entries(webhook.headers)) {
        headers[name.toLowerCase()] = renderTemplateText(value, context);
    }
    return {
        url: renderTemplateText(webhook.url, context),
        headers,
        body: renderTemplate(JSON.parse(webhook.bodyTemplate), context),
    };
}

async function send(
    webhook: WebhookFields,
    request: { url: string; headers: Record<string, string>; body: unknown },
): Promise<Delivery> {
    try {
        const response = await fetch(request.url, {
            method: webhook.method,
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal: AbortSignal.timeout(webhook.timeoutMs),
        });
        const text = (await response.text().catch(() => "")).slice(0, RESPONSE_PREVIEW_CHARS);
        return {
            status: response.status,
            error: response.ok ? null : `HTTP ${response.status} ${response.statusText}`.trim(),
            response: text || null,
        };
    } catch (err) {
        const error = err as Error;
        // undici hides the actual cause one level down, and a refused connection to a name
        // with several addresses is an AggregateError whose own message is empty.
        const cause = error.cause as (Error & { code?: string; errors?: Error[] }) | undefined;
        const message =
            error.name === "TimeoutError"
                ? `No answer within ${webhook.timeoutMs} ms`
                : cause?.message || cause?.errors?.[0]?.message || cause?.code || error.message;
        return { status: null, error: message, response: null };
    }
}

/** Worth another try: nothing answered, the target failed, or it asked to slow down. */
function retryable(delivery: Delivery): boolean {
    return delivery.status === null || delivery.status >= 500 || delivery.status === 429;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function deliver(webhook: Webhook, record: ActivityRecord): Promise<void> {
    let request;
    try {
        request = render(webhook, record, dcInfo(record));
    } catch (err) {
        const error = `Template could not be rendered: ${(err as Error).message}`;
        // `reason`, not `error`: pino-pretty takes that key for an Error object and drops a string.
        logger.warn({ webhook: webhook.name, event: record.id, reason: error }, "Webhook not sent");
        WebhookRepository.recordResult(webhook.id, null, error);
        return;
    }

    let delivery = await send(webhook, request);
    for (const delay of RETRY_DELAYS_MS) {
        if (delivery.error === null || !retryable(delivery)) break;
        await wait(delay);
        delivery = await send(webhook, request);
    }

    // Logged without the request: its headers are where a token would be.
    if (delivery.error !== null) {
        logger.warn(
            { webhook: webhook.name, event: record.id, kind: record.kind, reason: delivery.error },
            "Webhook delivery failed",
        );
    } else {
        logger.debug({ webhook: webhook.name, event: record.id }, "Webhook delivered");
    }
    WebhookRepository.recordResult(webhook.id, delivery.status, delivery.error);
}

function enqueue(webhook: Webhook, record: ActivityRecord): void {
    const queue = queues.get(webhook.id) ?? { tail: Promise.resolve(), pending: 0 };
    if (queue.pending >= MAX_PENDING_PER_WEBHOOK) {
        logger.warn(
            { webhook: webhook.name, event: record.id },
            "Webhook is too far behind, dropping the event for it",
        );
        return;
    }
    queue.pending++;
    queue.tail = queue.tail
        .then(() => deliver(webhook, record))
        .catch((err) => logger.error({ err, webhook: webhook.name }, "Webhook delivery threw"))
        .finally(() => {
            queue.pending--;
            if (queue.pending === 0) queues.delete(webhook.id);
        });
    queues.set(webhook.id, queue);
}

export class WebhookService {
    /**
     * Hands newly stored events to every enabled webhook whose filters they pass. Returns at
     * once: the deliveries run behind it, so a slow target never holds up whoever recorded the event.
     */
    static dispatch(records: ActivityRecord[]): void {
        if (records.length === 0) return;
        let webhooks: Webhook[];
        try {
            webhooks = WebhookRepository.findEnabled();
        } catch (err) {
            logger.error({ err }, "Could not read the webhooks");
            return;
        }
        for (const record of records) {
            for (const webhook of webhooks) {
                if (webhookAccepts(webhook, record)) enqueue(webhook, record);
            }
        }
    }

    /**
     * Sends the sample event for the webhook's kinds once, with what the editor holds -- saved or not -- and reports
     * the answer. No retries and no stored result: the operator is watching.
     */
    static async test(webhook: WebhookFields): Promise<WebhookTestResult> {
        const request = render(webhook, sampleWebhookRecord(webhook.kinds), SAMPLE_WEBHOOK_DC);
        const delivery = await send(webhook, request);
        return {
            ok: delivery.error === null,
            status: delivery.status,
            error: delivery.error,
            body: request.body,
            response: delivery.response,
        };
    }
}
