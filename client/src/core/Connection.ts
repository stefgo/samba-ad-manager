import WebSocket from "ws";

import os from "os";
import { config } from "./Config.js";
import { getIdentity } from "./Identity.js";
import { getWebSocketUrl } from "./RegistrationState.js";
import {
    WS_EVENTS,
    WsMessage,
    ProtocolMap,
    ActivityAckSchema,
    AGENT_CAPABILITIES,
} from "@sadm/shared";

import { logger } from "@sadm/shared/node";
import { VERSION } from "./Version.js";
import { isCertificateError } from "./ServerHttp.js";
import { ActivityService } from "../services/ActivityService.js";
import { handleAgentRequest } from "./AgentRequests.js";
import { DockerService } from "../services/DockerService.js";
import { LdapService } from "../services/LdapService.js";
import { DirectoryService } from "../services/DirectoryService.js";

/**
 * Backoff for reconnect attempts, in milliseconds. The same ladder as
 * ClientConnector.RECONNECT_DELAYS on the server, which dials outbound agents: both
 * directions of the same link should behave alike.
 */
const RECONNECT_DELAYS_MS = [5000, 10000, 30000, 60000];

/** Added per attempt, so a fleet does not come back in lockstep after a server restart. */
const RECONNECT_JITTER_MS = 3000;

/**
 * What this agent tells the server it can do, in every AUTH payload. The server decides
 * from this list what to send and what to expect -- rather than comparing version strings,
 * which would have to be taught every release.
 */
const CAPABILITIES: string[] = [
    ...(DockerService.isConfigured() || LdapService.isConfigured() ? [AGENT_CAPABILITIES.HEALTH] : []),
    ...(DirectoryService.isEnabled() ? [AGENT_CAPABILITIES.DIRECTORY] : []),
    ...(DirectoryService.isWritable() ? [AGENT_CAPABILITIES.DIRECTORY_WRITE] : []),
];

export class Connection {
    private static wsInstance: WebSocket | null = null;
    /** One timer for the whole agent: two of them would be two reconnect loops. */
    private static reconnectTimer: NodeJS.Timeout | null = null;
    /**
     * The handshake under way, if any. Every caller while it runs gets this same attempt:
     * a second connect() used to close the socket still shaking hands and start over, so
     * calling it in a loop -- POST /api/connect needs no login -- kept a disconnected agent
     * from ever finishing a handshake. Settles within the 5s attempt timeout at the latest.
     */
    private static connecting: Promise<{ connected: boolean; error?: string }> | null =
        null;
    private static reconnectAttempts = 0;

    /**
     * Checks if the WebSocket connection to the server is currently open.
     */
    static isConnected(): boolean {
        return (
            this.wsInstance !== null &&
            this.wsInstance.readyState === WebSocket.OPEN
        );
    }

    /**
     * Sends a typed message payload to the server over the WebSocket connection.
     */
    static send<T extends keyof ProtocolMap>(
        type: T,
        payload: ProtocolMap[T]["req"],
    ): void {
        if (this.wsInstance && this.wsInstance.readyState === WebSocket.OPEN) {
            this.wsInstance.send(JSON.stringify({ type, payload }));
        }
    }

    /**
     * Told on every connection the server has accepted, so whoever reports a state can send
     * it at once instead of waiting for its next measurement. A listener rather than a call
     * into the services, which would import this class right back.
     */
    private static connectedListeners: (() => void)[] = [];

    static onConnected(listener: () => void): void {
        this.connectedListeners.push(listener);
    }

    private static notifyConnected(): void {
        for (const listener of this.connectedListeners) {
            try {
                listener();
            } catch (err) {
                logger.warn({ err }, "A listener failed on a new server connection");
            }
        }
    }

    /**
     * Hands ActivityService a way onto the wire, once.
     *
     * It reports whether the batch went out, and a `false` leaves the events queued: they
     * are held until the server acknowledges their ids, not until they have been sent. That
     * is what lets an unattended run at three in the morning still be accounted for -- the
     * queue is offered again on the next connection, and the ids it carries make a second
     * delivery a no-op on the server.
     */
    private static activityWired = false;

    static wireActivity(): void {
        if (this.activityWired) return;
        this.activityWired = true;
        ActivityService.setTransport((events) => {
            if (!Connection.isConnected()) return false;
            Connection.send(WS_EVENTS.ACTIVITY, { events });
            return true;
        });
    }

    /**
     * What the server may send an authenticated agent, and who handles it.
     *
     * The same two branches used to stand in both message handlers -- once for the
     * connection this agent dials and once for the one the server dials -- although the
     * server sends the same messages either way. The table is the one place a new message
     * type has to be added; a copy that was forgotten would have left one of the two
     * directions silently ignoring it.
     *
     * The handshake is not in here on purpose. `AUTH_SUCCESS` belongs to connect(), which
     * ties the attempt timeout, the reconnect ladder and the promise it has to settle to
     * it -- none of which a table entry could carry.
     */
    private static readonly SERVER_MESSAGE_HANDLERS: Record<
        string,
        (ws: WebSocket, payload: unknown) => void
    > = {
        [WS_EVENTS.AGENT_REQUEST]: (ws, payload) => {
            // Answered on the socket the request came in on: a reconnect in between means
            // the server has given up on it already.
            void handleAgentRequest(payload).then((response) => {
                if (response && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: WS_EVENTS.AGENT_RESPONSE, payload: response }));
                }
            });
        },
        [WS_EVENTS.ACTIVITY_ACK]: (_ws, payload) => {
            const parsed = ActivityAckSchema.safeParse(payload);
            if (!parsed.success) {
                logger.warn(
                    { issues: parsed.error.issues },
                    "Ignoring malformed ACTIVITY_ACK from server",
                );
                return;
            }
            ActivityService.acknowledge(parsed.data.ids);
        },
    };

    /**
     * Dispatches one message from the server. An unknown type is dropped: a server of a
     * newer build may know messages this agent does not, which is not an error on either
     * side. Returns whether the message was handled, so a caller that owns further types
     * of its own -- the handshake in connect() -- can tell.
     */
    private static routeServerMessage(ws: WebSocket, message: WsMessage): boolean {
        const handler = Connection.SERVER_MESSAGE_HANDLERS[message.type];
        if (!handler) return false;
        handler(ws, message.payload);
        return true;
    }

    /**
     * Shared setup for an established WebSocket connection, in either connection mode.
     * Attaches heartbeat, message routing, and close handler to the socket.
     * The caller is responsible for the AUTH handshake before calling this.
     */
    static setupConnection(ws: WebSocket, onClose?: () => void): void {
        this.wsInstance = ws;

        let pingTimeout: NodeJS.Timeout;

        function heartbeat() {
            clearTimeout(pingTimeout);
            pingTimeout = setTimeout(() => {
                logger.warn("WebSocket heartbeat timeout. Terminating connection.");
                ws.terminate();
            }, 35000);
        }

        heartbeat();
        ws.on("ping", heartbeat);

        ws.on("message", (data: WebSocket.RawData) => {
            heartbeat();
            try {
                const message = JSON.parse(data.toString()) as WsMessage;
                Connection.routeServerMessage(ws, message);
            } catch (err) {
                logger.error({ err }, "Failed to parse message");
            }
        });

        ws.on("close", (code: number, reason: Buffer) => {
            clearTimeout(pingTimeout);
            // A socket that has already been replaced must not clear its successor.
            if (this.wsInstance === ws) this.wsInstance = null;
            const reasonStr = reason.toString() || "No reason provided";
            logger.warn(`Disconnected (Code: ${code}, Reason: ${reasonStr}).`);
            onClose?.();
        });

        ws.on("error", (err: Error) => {
            logger.error("Connection error: " + err.message);
            ws.close();
        });

        Connection.wireActivity();
        Connection.notifyConnected();
        // Whatever piled up while there was nowhere to send it.
        ActivityService.flush();
    }

    /**
     * Handles a WebSocket connection the server opened to this agent -- `outbound` mode,
     * named from the server's side, which is the side the mode names come from.
     * The server already authenticated the client via token check in the HTTP upgrade.
     * The client sends AUTH to complete the handshake, then calls setupConnection().
     */
    static handleIncoming(ws: WebSocket): void {
        if (this.wsInstance) {
            try { this.wsInstance.close(4000, "Replaced by new connection"); } catch { /* already closing */ }
            this.wsInstance = null;
        }

        logger.info("Server opened a connection to this agent (outbound mode), sending AUTH...");

        ws.send(JSON.stringify({
            type: WS_EVENTS.AUTH,
            payload: {
                hostname: os.hostname(),
                version: VERSION,
                capabilities: CAPABILITIES,
            },
        }));

        const authTimeout = setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close(4001, "Authentication timed out");
            }
        }, 5000);

        ws.once("message", (data: WebSocket.RawData) => {
            try {
                const message = JSON.parse(data.toString()) as WsMessage;
                if (message.type === WS_EVENTS.AUTH_SUCCESS) {
                    clearTimeout(authTimeout);
                    logger.info("Authenticated successfully (outbound mode)");
                    Connection.setupConnection(ws, () => {
                        // No auto-reconnect in outbound mode — the server dials again
                    });
                } else {
                    clearTimeout(authTimeout);
                    logger.warn(`Unexpected message during outbound-mode auth: ${message.type}`);
                    ws.close(4003, "Unexpected auth response");
                }
            } catch (err) {
                clearTimeout(authTimeout);
                logger.error({ err }, "Failed to parse the outbound-mode auth response");
                ws.close(4000, "Protocol error");
            }
        });
    }

    /**
     * Queues the next connection attempt. Every reconnect goes through here, and the single
     * timer is cleared first -- see connect() for how two loops used to come about.
     */
    private static scheduleReconnect(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

        const step = Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1);
        const delay =
            RECONNECT_DELAYS_MS[step] + Math.floor(Math.random() * RECONNECT_JITTER_MS);
        this.reconnectAttempts++;

        logger.warn(`Reconnecting in ${Math.round(delay / 1000)}s...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            Connection.connect();
        }, delay);
    }

    /**
     * Establishes a WebSocket connection to the central backend server -- `inbound` mode,
     * named from the server's side: the agent dials in. Reconnects with backoff after a
     * disconnect, which is this side's job here, unlike in outbound mode.
     */
    static connect(): Promise<{ connected: boolean; error?: string }> {
        if (this.connecting) return this.connecting;

        // A manual connect (the status page's retry) supersedes a queued one; otherwise the
        // pending timer would fire on top of the connection this call is about to open.
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.isConnected()) {
            return Promise.resolve({ connected: true });
        }

        const websocketURL = getWebSocketUrl();
        if (!websocketURL) {
            logger.warn("No Websocket URL configured. Connection skipped.");
            return Promise.resolve({
                connected: false,
                error: "No Websocket URL configured.",
            });
        }

        // Both halves go on the wire below: the server resolves the pair and refuses a
        // connection that presents only one of them.
        const identity = getIdentity();
        if (!identity) {
            logger.warn("No identity. Please register first. Connection skipped.");
            return Promise.resolve({
                connected: false,
                error: "No identity. Register first.",
            });
        }

        // Close any stale instance before retrying
        if (this.wsInstance) {
            try { this.wsInstance.close(); } catch { /* already closing */ }
            this.wsInstance = null;
        }

        const wsUrl = new URL(websocketURL);
        wsUrl.searchParams.set("clientId", identity.clientId);
        wsUrl.searchParams.set("token", identity.authToken);

        // The URL carries the auth token; the log gets it without, since logs travel further
        // than this host (`docker logs`, a collector).
        const logUrl = new URL(wsUrl);
        logUrl.searchParams.set("token", "***");
        logger.info(`Connecting to ${logUrl.toString()}...`);

        // Explicit rather than inherited from the process: the certificate check used to
        // depend on whether the web UI had set NODE_TLS_REJECT_UNAUTHORIZED earlier.
        const ws = new WebSocket(wsUrl.toString(), {
            rejectUnauthorized: !config.allowSelfSignedCertificates,
        });
        this.wsInstance = ws;

        const attempt = new Promise<{ connected: boolean; error?: string }>((resolve) => {
            let pingTimeout: NodeJS.Timeout;

            function heartbeat() {
                clearTimeout(pingTimeout);
                pingTimeout = setTimeout(() => {
                    logger.warn("WebSocket heartbeat timeout. Terminating connection.");
                    ws.terminate();
                }, 35000);
            }

            // The socket is closed on a timeout, and that is the point: it used to stay open while
            // the caller was told the attempt had failed. The next connect() then closed it, and
            // its close handler scheduled a reconnect of its own next to the attempt already
            // running -- two loops overtaking each other. Terminating routes the failure
            // through the one close handler below.
            const timeout = setTimeout(() => {
                logger.warn("Connection attempt timed out after 5s.");
                resolve({ connected: false, error: "Connection timeout (5s)." });
                ws.terminate();
            }, 5000);

            ws.on("open", () => {
                heartbeat();
                logger.info("Connected to server");
                Connection.send(WS_EVENTS.AUTH, {
                    hostname: os.hostname(),
                    version: VERSION,
                    capabilities: CAPABILITIES,
                });
            });

            ws.on("ping", heartbeat);

            ws.on("message", (data: WebSocket.RawData) => {
                heartbeat();
                try {
                    const message = JSON.parse(data.toString()) as WsMessage;

                    // The handshake first: it is this connection's own, and only it knows
                    // about the attempt timeout and the promise waiting on the result.
                    if (message.type === WS_EVENTS.AUTH_SUCCESS) {
                        clearTimeout(timeout);
                        // Reset on AUTH, not on open: a socket accepted and dropped before the
                        // handshake is not a working connection and must not restart the ladder.
                        Connection.reconnectAttempts = 0;
                        logger.info("Authenticated successfully");
                        resolve({ connected: true });
                        Connection.wireActivity();
                        Connection.notifyConnected();
                        ActivityService.flush();
                        return;
                    }

                    Connection.routeServerMessage(ws, message);
                } catch (err) {
                    logger.error({ err }, "Failed to parse message");
                }
            });

            ws.on("close", (code: number, reason: Buffer) => {
                clearTimeout(pingTimeout);
                clearTimeout(timeout);
                const reasonStr = reason.toString() || "No reason provided";
                resolve({ connected: false, error: `${reasonStr} (Code: ${code})` });

                // Closed because something newer took its place -- a later connect() or a
                // session the server opened. That one owns the connection now; scheduling a
                // reconnect from here is how a second loop used to start.
                if (this.wsInstance !== ws) {
                    logger.debug(`Superseded connection closed (Code: ${code}).`);
                    return;
                }
                this.wsInstance = null;
                logger.warn(`Disconnected (Code: ${code}, Reason: ${reasonStr}).`);
                Connection.scheduleReconnect();
            });

            ws.on("error", (err: Error) => {
                logger.error("Connection error: " + err.message);
                if (isCertificateError(err)) {
                    logger.error(
                        "The server's certificate could not be verified. If it is self-signed on purpose, set allowSelfSignedCertificates: true in config.yaml.",
                    );
                }
                ws.close();
            });
        });
        this.connecting = attempt;
        void attempt.finally(() => {
            if (this.connecting === attempt) this.connecting = null;
        });
        return attempt;
    }
}
