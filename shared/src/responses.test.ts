import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import {
    DomainControllerListSchema,
    SchedulerStatusResponseSchema,
    SchedulerStatusUpdateSchema,
    SchedulerStatusesSchema,
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

describe("DomainControllerListSchema", () => {
    const row = {
        id: "11111111-1111-4111-8111-111111111111",
        name: "DC1",
        dnsHostName: null,
        site: null,
        address: null,
        firstSeen: "2026-10-04T08:00:00.000Z",
        agent: null,
        agentRegistrationExpiresAt: null,
    };

    // One the directory names and says nothing else about: every nullable column is null, not missing.
    it("takes a row as SQLite hands it over", () => {
        expect(DomainControllerListSchema.safeParse([row]).success).toBe(true);
    });

    it("refuses a row without a name", () => {
        expect(DomainControllerListSchema.safeParse([{ ...row, name: undefined }]).success).toBe(false);
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
        const schedulers = { "notification-cleanup": { ...idle, lastRun: run } };
        expect(SchedulerStatusResponseSchema.parse({ schedulers }).schedulers["notification-cleanup"].lastRun?.result).toEqual({
            removed: 3,
        });
    });

    it("refuse a response that lacks a scheduler", () => {
        expect(SchedulerStatusResponseSchema.safeParse({ schedulers: {} }).success).toBe(false);
    });

    // What an earlier version stored must not take the whole status down.
    it("read a result of another shape as no result", () => {
        const status = { ...idle, lastRun: { ...run, result: { deleted: 3 } } };
        const parsed = SchedulerStatusUpdateSchema.parse({ scheduler: "notification-cleanup", status });
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
