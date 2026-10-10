import { WebSocket } from "ws";
import {
    WS_EVENTS,
    WsMessage,
    AuthPayloadSchema,
    ConnectionMode,
} from "@sadm/shared";
import { ProxyService } from "../../services/ProxyService.js";
import { ActivityService } from "../../services/ActivityService.js";
import { ClientRepository } from "../../repositories/ClientRepository.js";
import { routeAgentMessage } from "./AgentMessageRouter.js";

/**
 * How long an agent has to send its `AUTH` before the socket is dropped.
 *
 * Short on purpose: a peer that got this far has already presented its credentials,
 * so anything that does not follow up is a zombie connection.
 */
const AUTH_TIMEOUT_MS = 5000;

/**
 * The logging the session does. Both pino instances in play satisfy it -- `fastify.log`
 * on the inbound route and the shared logger on the outbound one -- so the session does
 * not have to know which one it got.
 */
export interface SessionLogger {
    info(obj: object, msg?: string): void;
    warn(obj: object, msg?: string): void;
    error(obj: object, msg?: string): void;
}

/** Why the handshake did not complete. The caller decides what that means on its side. */
export type AuthFailureReason =
    | "timeout"
    | "invalid-payload"
    | "unexpected-message";

export interface AgentSessionOptions {
    /** The client this socket belongs to -- already resolved by the caller. */
    clientId: string;
    socket: WebSocket;
    connectionMode: ConnectionMode;
    /**
     * The address the peer came in from, or null when the server dialled it: there is
     * then no remote address worth recording, only the one it was dialled at, which is
     * already stored as `outbound_target_address`.
     */
    ip: string | null;
    log: SessionLogger;
    /**
     * Called on a successful handshake, before the row is updated. This is where the
     * outbound path creates the entry for a client connecting for the first time.
     */
    onAuthenticated?: (version: string | null) => void;
    /** Called once per failed handshake, with the reason it failed. */
    onAuthFailed?: (reason: AuthFailureReason) => void;
    /** Called after an authenticated connection has been torn down. */
    onClose?: () => void;
}

/**
 * The name a connection event is shown under. Stored with the event, so the line still
 * names the host after it has been renamed or removed.
 */
function clientName(clientId: string): string {
    const client = ClientRepository.findById(clientId);
    return client?.display_name || client?.hostname || clientId;
}

/**
 * Runs an agent connection from the `AUTH` handshake to the close.
 *
 * Both connection kinds used to carry their own copy of this: the same timeout, the same
 * Zod check, the same register/record/broadcast sequence and the same close block, once
 * for the agent that dials the server and once for the agent the server dials. Two copies
 * of a handshake is how the two quietly drift apart -- and this one spans the point where
 * a client is marked online, so a difference between them shows up as a host that is
 * connected on one route and not on the other.
 *
 * Deliberately *not* in here:
 * - **The heartbeat.** The inbound route attaches it before its credential checks, so
 *   that a rejected connection loses its ping timer too; by the time a session starts,
 *   it is already running.
 * - **Everything before the handshake.** Credentials and address checks inbound, the
 *   auth-result and reconnect plumbing outbound. Those are what actually differ.
 *
 * @returns Nothing -- the session lives on the socket's own handlers.
 */
export function attachAgentSession(options: AgentSessionOptions): void {
    const {
        clientId,
        socket,
        connectionMode,
        ip,
        log,
        onAuthenticated,
        onAuthFailed,
        onClose,
    } = options;

    let isAuthenticated = false;

    const authTimeout = setTimeout(() => {
        if (!isAuthenticated && socket.readyState === socket.OPEN) {
            log.warn({ clientId, ip }, "Agent authentication timed out");
            onAuthFailed?.("timeout");
            socket.close(4001, "Authentication timed out");
        }
    }, AUTH_TIMEOUT_MS);

    // The socket may close before the handshake ever runs -- a dial that is refused, an
    // error, a peer that goes away. The timer has to go either way.
    socket.on("close", () => clearTimeout(authTimeout));

    socket.on("message", (message: Buffer) => {
        try {
            const data = JSON.parse(message.toString()) as WsMessage;

            if (isAuthenticated) {
                routeAgentMessage(clientId, data);
                return;
            }

            if (data.type !== WS_EVENTS.AUTH) {
                onAuthFailed?.("unexpected-message");
                socket.close(4003, "Forbidden");
                return;
            }

            const parsed = AuthPayloadSchema.safeParse(data.payload);
            if (!parsed.success) {
                onAuthFailed?.("invalid-payload");
                socket.close(4000, "Invalid payload");
                return;
            }

            isAuthenticated = true;
            clearTimeout(authTimeout);

            const version = parsed.data.version || null;

            onAuthenticated?.(version);
            // The address is recorded only here, past the allowed-address check the
            // inbound route ran before starting this session: the stored value is then
            // always one that was let in, which is what makes it a useful reference in
            // the client editor.
            ClientRepository.updateAuthSuccess(clientId, version, ip);

            log.info({ clientId, connectionMode }, "Agent authenticated");
            ProxyService.registerClient(clientId, socket, parsed.data.capabilities);
            ActivityService.record({
                kind: "client.connected",
                level: "trace",
                clientId,
                data: {
                    connectionMode,
                    version,
                    ...(ip === null ? {} : { ip }),
                    clientName: clientName(clientId),
                },
            });

            socket.send(JSON.stringify({
                type: WS_EVENTS.AUTH_SUCCESS,
                payload: { lastSyncTime: null },
            }));
            ProxyService.broadcastClientUpdate();

            socket.on("close", () => {
                ClientRepository.updateLastSeen(clientId);
                ProxyService.unregisterClient(clientId, socket);
                log.info({ clientId, connectionMode }, "Agent disconnected");
                ActivityService.record({
                    kind: "client.disconnected",
                    level: "trace",
                    clientId,
                    data: {
                        connectionMode,
                        clientName: clientName(clientId),
                    },
                });
                ProxyService.broadcastClientUpdate();
                onClose?.();
            });
        } catch (err) {
            log.error({ clientId, err }, "Error processing agent message");
        }
    });
}
