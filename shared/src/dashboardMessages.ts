import { z } from "zod";
import { WS_EVENTS } from "./constants.js";
import {
    ActivityListSchema,
    DnsServerHealthListSchema,
    DomainControllerListSchema,
    DomainIssueStateListSchema,
    SchedulerStatusUpdateSchema,
    ServiceUrlHealthListSchema,
} from "./responses.js";
import { DcHealthSchema } from "./dcHealth.js";

/**
 * Every message the server pushes over `/ws/dashboard`, as one discriminated union.
 *
 * Both ends hang on it. The backend's `broadcastToDashboard` takes a `DashboardMessage`, so
 * it cannot send a shape that is not listed here; the dashboard parses against the schema
 * and dispatches in a `switch` that ends in `assertNever`, so a member added here without a
 * case there fails `typecheck`.
 *
 * A union over `type` rather than separate parses: the dashboard sees one stream, and a
 * message of an unknown type has to fail here, not somewhere downstream. The server is
 * trusted, so this is a guard against version drift between the two halves, not against an
 * attacker.
 */
export const DashboardMessageSchema = z.discriminatedUnion("type", [
    /** The domain controllers the directory lists; also the first message on connect. */
    z.object({ type: z.literal(WS_EVENTS.DOMAIN_CONTROLLERS_UPDATE), payload: DomainControllerListSchema }),
    /**
     * What is known of one domain controller: sent for every one on connect, and again with
     * each new measurement and each report of its agent.
     */
    z.object({ type: z.literal(WS_EVENTS.DC_HEALTH_UPDATE), payload: DcHealthSchema }),
    /** The whole activity list: on connect, with this user's seen state, and empty after "Delete all". */
    z.object({ type: z.literal(WS_EVENTS.ACTIVITY_UPDATE), payload: ActivityListSchema }),
    /** Events stored for the first time, to be merged into the list by id. */
    z.object({ type: z.literal(WS_EVENTS.ACTIVITY_APPENDED), payload: ActivityListSchema }),
    /** The events the session's user has just marked seen. Sent to that user's sessions only. */
    z.object({
        type: z.literal(WS_EVENTS.ACTIVITY_SEEN),
        payload: z.object({ ids: z.array(z.string()) }),
    }),
    /** One server scheduler, whenever a run starts or ends or its timer moves. */
    z.object({ type: z.literal(WS_EVENTS.SCHEDULER_STATUS_UPDATE), payload: SchedulerStatusUpdateSchema }),
    /** Every name server that is no domain controller, whole: on connect, and whenever they were asked again. */
    z.object({ type: z.literal(WS_EVENTS.DNS_SERVERS_UPDATE), payload: DnsServerHealthListSchema }),
    /** Every URL of `directory.serviceUrls`, whole: on connect, and whenever they were asked again. */
    z.object({ type: z.literal(WS_EVENTS.SERVICE_URLS_UPDATE), payload: ServiceUrlHealthListSchema }),
    /** Where every finding stands with the activity, whole: on connect, and whenever that changed. */
    z.object({ type: z.literal(WS_EVENTS.DOMAIN_ISSUES_UPDATE), payload: DomainIssueStateListSchema }),
]);

/** One message of the server-to-dashboard stream, as `DashboardMessageSchema` parses it. */
export type DashboardMessage = z.infer<typeof DashboardMessageSchema>;
export type DashboardMessageType = DashboardMessage["type"];
