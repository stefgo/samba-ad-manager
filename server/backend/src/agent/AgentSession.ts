import { WebSocket } from "ws";
import { AGENT_EVENTS, AgentAuthPayloadSchema, type AgentAuthPayload, type AgentMessage, type ConnectionMode } from "@sadm/shared";
import { logger } from "../core/logger.js";

/**
 * How long an agent has to send its `AUTH` before the socket is dropped. Short on purpose: a
 * peer that got this far has already presented its token, so one that does not follow up is
 * a zombie connection.
 */
const AUTH_TIMEOUT_MS = 5000;

export interface AgentSessionOptions {
    /** The domain controller this socket belongs to -- already established by the token. */
    dcId: string;
    socket: WebSocket;
    connectionMode: ConnectionMode;
    /** A successful handshake. Returns why the agent is refused after all, or null to accept it. */
    onAuthenticated: (auth: AgentAuthPayload) => string | null;
    /** One message of an authenticated agent. */
    onMessage: (message: AgentMessage) => void;
    /** A handshake that did not complete. */
    onAuthFailed?: (reason: string) => void;
    /** An authenticated connection that has been torn down. */
    onClose: () => void;
}

/**
 * Runs an agent connection from the `AUTH` handshake to the close, the same for an agent
 * that dialled and for one the server dialled: two copies of a handshake is how the two
 * quietly drift apart, and this one spans the point where an agent is marked connected.
 *
 * Not in here: the heartbeat, which the caller attaches before its own checks so that a
 * rejected connection loses its ping timer too, and everything before the handshake --
 * the token check inbound, the reconnect plumbing outbound. Those are what differ.
 */
export function attachAgentSession(options: AgentSessionOptions): void {
    const { dcId, socket, connectionMode, onAuthenticated, onMessage, onAuthFailed, onClose } = options;
    let authenticated = false;

    const refuse = (code: number, reason: string, said = reason) => {
        onAuthFailed?.(reason);
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: AGENT_EVENTS.AUTH_FAILURE, payload: { error: said } }));
            socket.close(code, reason.slice(0, 100));
        }
    };

    const authTimeout = setTimeout(() => {
        if (!authenticated) {
            logger.warn({ dcId, connectionMode }, "Agent authentication timed out");
            refuse(4001, "Authentication timed out");
        }
    }, AUTH_TIMEOUT_MS);

    // The socket may close before the handshake ever runs. The timer has to go either way.
    socket.on("close", () => clearTimeout(authTimeout));

    socket.on("message", (raw: Buffer) => {
        let message: AgentMessage;
        try {
            message = JSON.parse(raw.toString()) as AgentMessage;
        } catch {
            logger.warn({ dcId }, "An agent sent something that is no message");
            return;
        }

        if (authenticated) {
            try {
                onMessage(message);
            } catch (err) {
                logger.error({ dcId, err, type: message?.type }, "Error processing an agent's message");
            }
            return;
        }

        if (message?.type !== AGENT_EVENTS.AUTH) {
            refuse(4003, "Forbidden", "The first message has to be AUTH");
            return;
        }
        const parsed = AgentAuthPayloadSchema.safeParse(message.payload);
        if (!parsed.success) {
            refuse(4000, "Invalid payload", "The AUTH payload is not one this server reads");
            return;
        }
        const refusal = onAuthenticated(parsed.data);
        if (refusal) {
            logger.warn({ dcId, connectionMode }, `Agent refused: ${refusal}`);
            refuse(4003, "Refused", refusal);
            return;
        }

        authenticated = true;
        clearTimeout(authTimeout);
        logger.info({ dcId, connectionMode, version: parsed.data.version }, "Agent connected");
        socket.send(JSON.stringify({ type: AGENT_EVENTS.AUTH_SUCCESS, payload: {} }));
        socket.on("close", () => {
            logger.info({ dcId, connectionMode }, "Agent disconnected");
            onClose();
        });
    });
}
