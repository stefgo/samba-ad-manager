import { WS_EVENTS, WsMessage } from "@sadm/shared";
import { logger } from "@sadm/shared/node";
import { ActivityService } from "../../services/ActivityService.js";
import { AgentRpc } from "../../services/AgentRpc.js";
import { DcHealthService } from "../../services/DcHealthService.js";

/**
 * What an authenticated agent may send, and who handles it.
 *
 * The same two branches used to stand in both connection handlers -- once for the agent
 * that dials the server and once for the agent the server dials -- although the messages
 * are identical in both directions. A third message type would have had to be added twice,
 * and a forgotten copy shows up only at runtime, on whichever direction was missed.
 *
 * The handshake is deliberately not in here. `AUTH` is not a message an authenticated
 * agent sends, and each connection kind ties its own side effects to it: clearing a
 * timeout, persisting a new client, resetting a reconnect ladder. A table entry cannot
 * carry those, so the handshake stays with the connection that owns it.
 *
 * Payloads arrive unvalidated. Each handler parses its own with Zod --
 * they are the ones that know the shape they need.
 */
const AGENT_MESSAGE_HANDLERS: Record<
    string,
    (clientId: string, payload: unknown) => void
> = {
    [WS_EVENTS.DC_HEALTH]: (clientId, payload) =>
        DcHealthService.handleReport(clientId, payload),
    [WS_EVENTS.AGENT_RESPONSE]: (clientId, payload) =>
        AgentRpc.handleResponse(clientId, payload),
    [WS_EVENTS.ACTIVITY]: (clientId, payload) =>
        ActivityService.handleBatch(clientId, payload),
};

/**
 * Dispatches one message from an authenticated agent.
 *
 * An unknown type is logged at debug and dropped: an agent of a newer build may know
 * messages this server does not, and that is not an error on either side.
 */
export function routeAgentMessage(clientId: string, message: WsMessage): void {
    const handler = AGENT_MESSAGE_HANDLERS[message.type];
    if (!handler) {
        logger.debug({ clientId, type: message.type }, "Ignoring unknown agent message");
        return;
    }
    handler(clientId, message.payload);
}
