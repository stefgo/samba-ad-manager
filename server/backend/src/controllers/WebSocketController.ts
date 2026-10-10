import { FastifyInstance, FastifyRequest } from "fastify";
import { WebSocket } from "ws";
import {
    WS_EVENTS,
    CONNECTION_MODE,
    isIpAllowed,
    isIpInNetworks,
} from "@sadm/shared";
import { ProxyService } from "../services/ProxyService.js";
import { ActivityService } from "../services/ActivityService.js";
import { appConfig } from "../config/AppConfig.js";

import { ClientRepository } from "../repositories/ClientRepository.js";
import { logger } from "@sadm/shared/node";
import { attachHeartbeat } from "./websocket/Heartbeat.js";
import { attachAgentSession } from "./websocket/AgentSession.js";
import { SESSION_COOKIE } from "../services/SessionCookie.js";
import { AuthService } from "../services/AuthService.js";

/** The identity the agent route accepts in its query string. */
export type AgentQuery = { token?: string; clientId?: string };

/** The agent route's request, with its query string named rather than read out of `any`. */
type AgentRequest = FastifyRequest<{ Querystring: AgentQuery }>;

export class WebSocketController {
    static async handleDashboardConnection(
        socket: WebSocket,
        req: FastifyRequest,
        fastify: FastifyInstance,
    ) {
        // Attached before the auth checks below: those close the socket and return early,
        // and attachHeartbeat registers the close handler that clears the interval. The
        // interval used to be cleared only by the handler at the end of this method, so
        // every rejected connection left a ping timer running forever.
        attachHeartbeat(socket);

        // Read from the session cookie, which the browser attaches to the handshake by itself.
        // It used to arrive as ?token=<JWT>: the browser WebSocket API cannot set headers, so
        // the query string was the only place for it -- and from there it went into every
        // proxy and server access log along the way.
        const token: string | undefined = req.cookies?.[SESSION_COOKIE];
        if (!token) {
            socket.close(4001, "Unauthorized");
            return;
        }

        // The user is kept with the socket, so what concerns one user alone -- the seen state
        // of the activity -- can go to that user's sessions only.
        let userId: number;
        try {
            const payload = fastify.jwt.verify<{ id?: unknown; tv?: unknown }>(token);
            // Same rule as the REST hook: a deleted user or a changed password ends the
            // session, not only the token's expiry.
            if (!AuthService.isSessionCurrent(payload)) {
                socket.close(4001, "Session is no longer valid");
                return;
            }
            userId = payload.id as number;
        } catch {
            socket.close(4001, "Invalid Token");
            return;
        }

        ProxyService.addDashboardClient(socket, userId);

        // Send initial state
        ProxyService.sendToDashboard(socket, {
            type: WS_EVENTS.CLIENTS_UPDATE,
            payload: ProxyService.getClientsWithStatus(),
        });

        // Send the initial activity list
        ProxyService.sendToDashboard(socket, {
            type: WS_EVENTS.ACTIVITY_UPDATE,
            payload: ActivityService.list(userId),
        });

        socket.on("close", () => {
            ProxyService.removeDashboardClient(socket);
        });
    }

    /**
     * Handles a server-initiated (outbound) WebSocket connection to an inbound client.
     * The client sends AUTH after the connection is established; the server responds
     * with AUTH_SUCCESS and then routes all further messages normally.
     *
     * @param clientId - The client's UUID (already known from DB)
     * @param socket   - The already-open WebSocket socket
     * @param onClose  - Called when the connection closes (e.g. to schedule reconnect)
     */
    static handleOutboundAgentConnection(
        clientId: string,
        socket: WebSocket,
        onClose: () => void,
        onAuthResult?: (success: boolean) => void,
        onPersist?: (version: string | null) => void,
    ): void {
        logger.info({ clientId }, "ClientConnector: outbound agent connection established, awaiting AUTH");

        attachHeartbeat(socket);

        // Ensures onAuthResult is called exactly once regardless of failure mode.
        let authResultSent = false;
        const notifyAuthResult = (success: boolean) => {
            if (!authResultSent) {
                authResultSent = true;
                onAuthResult?.(success);
            }
        };

        attachAgentSession({
            clientId,
            socket,
            connectionMode: CONNECTION_MODE.OUTBOUND,
            // No address to record: the server dialled this agent, so the only address
            // involved is the one it was dialled at, already stored as
            // outbound_target_address.
            ip: null,
            log: logger,
            onAuthenticated: (version) => {
                // onPersist creates the DB entry for new clients (first-time connection).
                // For reconnects the entry already exists and the session's own
                // updateAuthSuccess refreshes it.
                onPersist?.(version);
                notifyAuthResult(true);
            },
            onAuthFailed: () => notifyAuthResult(false),
            onClose,
        });

        socket.on("error", (err) => {
            logger.error({ clientId, err: err.message }, "Outbound agent socket error");
            socket.close();
        });

        // Covers all remaining failure paths: socket closed before AUTH completed,
        // or after an error — notifyAuthResult is a no-op if already called.
        socket.on("close", () => {
            notifyAuthResult(false);
        });
    }

    static async handleAgentConnection(
        socket: WebSocket,
        req: AgentRequest,
        fastify: FastifyInstance,
    ) {
        // The socket's peer, or the forwarded address if the peer is a listed proxy
        // (security.trusted_proxies) -- allowed_networks below is checked against this.
        const clientIp = req.ip;
        fastify.log.info({ msg: "Client connected", ip: clientIp });

        // Read by the timeout log below, which fires long after this line: null while the
        // peer is still anonymous, the resolved id once the credentials below named a row.
        let clientId: string | null = null;
        attachHeartbeat(socket, () =>
            fastify.log.warn({
                msg: "Agent client connection timed out (no pong). Terminating.",
                ip: clientIp,
                clientId,
            }),
        );

        // AUTHENTICATION LOGIC (Identity + IP)
        // 1. Extract the identity: query params first, then Authorization header for the
        // token. WebSocket connections from a browser usually use query params ?token=...,
        // agents might use headers.
        const query = req.query;
        let token = query.token;
        if (!token && req.headers["authorization"]) {
            const parts = req.headers["authorization"].split(" ");
            if (parts.length === 2 && parts[0] === "Bearer") {
                token = parts[1];
            }
        }
        const presentedId = query.clientId;

        if (!token || !presentedId) {
            fastify.log.warn({
                msg: "Client connected without a complete identity",
                ip: clientIp,
            });
            socket.close(4001, "Authentication required");
            return;
        }

        // Both halves have to name the same row.
        const client = ClientRepository.findByIdAndToken(presentedId, token);

        if (!client) {
            fastify.log.warn({
                msg: "Invalid credentials used",
                ip: clientIp,
                clientId: presentedId,
            });
            socket.close(4003, "Invalid credentials");
            return;
        }

        // Global Security Check: Allowed Networks
        const allowedNetworks = appConfig.security.allowed_networks;
        if (!isIpInNetworks(clientIp, allowedNetworks, true)) {
            fastify.log.warn({
                msg: "Connection denied: IP not in allowed networks",
                ip: clientIp,
            });
            socket.close(4003, "Access denied");
            return;
        }

        // An outbound client is dialled by the server and never connects here. Refused
        // explicitly: its auth token has no allowed address, and with null meaning "check
        // switched off" that token would otherwise be accepted from anywhere.
        if (client.connection_mode === CONNECTION_MODE.OUTBOUND) {
            fastify.log.warn({
                msg: "Outbound client tried to connect inbound",
                ip: clientIp,
                clientId: client.id,
            });
            socket.close(4003, "Access denied");
            return;
        }

        // Per-client address check. trusted_networks used to skip it for listed networks,
        // which meant the stored value was checked or not depending on a setting elsewhere;
        // it is gone, and a client whose address changes is edited or unrestricted instead.
        if (!isIpAllowed(clientIp, client.inbound_allowed_ip)) {
            fastify.log.warn({
                msg: "IP mismatch for client",
                expected: client.inbound_allowed_ip,
                actual: clientIp,
                clientId: client.id,
            });
            socket.close(4003, "IP address mismatch");
            return;
        }

        clientId = client.id;

        // From here the connection is an ordinary agent session: the agent sends
        // { type: 'AUTH' } as its first message, and everything after that is the same
        // in both directions.
        attachAgentSession({
            clientId,
            socket,
            connectionMode: CONNECTION_MODE.INBOUND,
            ip: clientIp,
            log: fastify.log,
            // The agent is told it was turned away only when it sent something other than
            // AUTH: a malformed AUTH payload gets the close code alone, which is what
            // names the problem. An unexpected first message is the case where the peer
            // may simply be out of step with the handshake.
            onAuthFailed: (reason) => {
                if (reason === "unexpected-message") {
                    socket.send(
                        JSON.stringify({
                            type: WS_EVENTS.AUTH_FAILURE,
                            payload: {},
                        }),
                    );
                }
            },
        });
    }
}
