import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import {
    ClientViewSchema,
    SchedulerStatusResponseSchema,
    SchedulerStatusUpdateSchema,
    SchedulerStatusesSchema,
    TokenListSchema,
    WebhookTestResultSchema,
    WebhookViewSchema,
} from "./responses.js";
import type { SchedulerStatuses, SchedulerStatusUpdate, Webhook } from "./types.js";

const idle = { isRunning: false, nextRun: null, lastRun: null };

describe("types that are written by hand next to their schema", () => {
    // The schedulers are generic over their id, which a schema cannot be inferred into.
    it("agree with what the schema parses", () => {
        expectTypeOf<z.infer<typeof SchedulerStatusesSchema>>().toEqualTypeOf<SchedulerStatuses>();
        expectTypeOf<z.infer<typeof SchedulerStatusUpdateSchema>>().toEqualTypeOf<SchedulerStatusUpdate>();
        expectTypeOf<z.infer<typeof WebhookViewSchema>>().toEqualTypeOf<Webhook>();
    });
});

describe("ClientViewSchema", () => {
    const row = {
        id: "c1",
        hostname: "host",
        displayName: null,
        site: null,
        status: "offline",
        lastSeen: null,
        version: null,
        connectionMode: "inbound",
        inboundAllowedIp: null,
        inboundLastIp: null,
        outboundTargetAddress: null,
        capabilities: null,
        createdAt: "2026-10-04 08:00:00",
        updatedAt: null,
    };

    // A client that never connected: every nullable column is null, not missing.
    it("takes a row as SQLite hands it over", () => {
        expect(ClientViewSchema.safeParse(row).success).toBe(true);
    });

    // The input rule of ClientSchema; a response is not refused over the form of an id.
    it("takes an id that is not a UUID", () => {
        expect(ClientViewSchema.parse(row).id).toBe("c1");
    });

    it("refuses a status it does not know", () => {
        expect(ClientViewSchema.safeParse({ ...row, status: "asleep" }).success).toBe(false);
    });
});

describe("TokenListSchema", () => {
    // `used_at` is a nullable column: an unused token carries null, not a missing key.
    it("takes a token that has not been used", () => {
        const token = {
            tokenHash: "ab",
            createdAt: "2026-10-04 08:00:00",
            expiresAt: "2026-10-05 08:00:00",
            usedAt: null,
            displayName: null,
            inboundAllowedIp: null,
        };
        expect(TokenListSchema.safeParse([token]).success).toBe(true);
    });
});

describe("the scheduler schemas", () => {
    const run = {
        trigger: "manual",
        status: "success",
        startedAt: "2026-10-04T08:00:00Z",
        finishedAt: "2026-10-04T08:00:01Z",
        result: { removed: 3 },
        error: null,
    };

    it("take the status of every scheduler", () => {
        const schedulers = { "notification-cleanup": idle, "token-cleanup": { ...idle, lastRun: run } };
        expect(SchedulerStatusResponseSchema.parse({ schedulers }).schedulers["token-cleanup"].lastRun?.result).toEqual({
            removed: 3,
        });
    });

    it("refuse a response that lacks a scheduler", () => {
        expect(SchedulerStatusResponseSchema.safeParse({ schedulers: { "token-cleanup": idle } }).success).toBe(false);
    });

    // What an earlier version stored must not take the whole status down.
    it("read a result of another shape as no result", () => {
        const status = { ...idle, lastRun: { ...run, result: { deleted: 3 } } };
        const parsed = SchedulerStatusUpdateSchema.parse({ scheduler: "token-cleanup", status });
        expect(parsed.status.lastRun?.result).toBeNull();
    });

    it("refuse an update for a scheduler that does not exist", () => {
        expect(SchedulerStatusUpdateSchema.safeParse({ scheduler: "image-cleanup", status: idle }).success).toBe(false);
    });
});

describe("WebhookViewSchema", () => {
    const webhook = {
        id: "w1",
        name: "x".repeat(200),
        enabled: true,
        url: "not a url",
        method: "POST",
        headers: {},
        bodyTemplate: "",
        minLevel: "warning",
        kinds: [],
        timeoutMs: 10,
        lastStatus: null,
        lastError: null,
        lastAttemptAt: null,
        createdAt: "2026-10-04 08:00:00",
        updatedAt: null,
    };

    // A row somebody edited by hand must not take the list down.
    it("takes a stored webhook that the form would refuse", () => {
        expect(WebhookViewSchema.safeParse(webhook).success).toBe(true);
    });

    it("refuses a webhook without an id", () => {
        expect(WebhookViewSchema.safeParse({ ...webhook, id: undefined }).success).toBe(false);
    });
});

describe("WebhookTestResultSchema", () => {
    it("takes a delivery that got no answer", () => {
        const result = { ok: false, status: null, error: "timeout", body: { text: "x" }, response: null };
        expect(WebhookTestResultSchema.parse(result)).toEqual(result);
    });
});
