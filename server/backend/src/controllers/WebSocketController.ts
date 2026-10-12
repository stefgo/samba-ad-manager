import { FastifyInstance, FastifyRequest } from "fastify";
import { WebSocket } from "ws";
import { WS_EVENTS } from "@sadm/shared";
import { DcAgentService } from "../services/DcAgentService.js";
import { DcHealthService } from "../services/DcHealthService.js";
import { DashboardHub } from "../services/DashboardHub.js";
import { DnsServerHealthService } from "../services/DnsServerHealthService.js";
import { DomainControllerService } from "../services/DomainControllerService.js";
import { ActivityService } from "../services/ActivityService.js";
import { attachHeartbeat } from "./Heartbeat.js";
import { SESSION_COOKIE } from "../services/SessionCookie.js";
import { AuthService } from "../services/AuthService.js";

/** The identity an agent presents when it dials in. */
export type AgentQuery = { Querystring: { clientId?: string; token?: string } };

export class WebSocketController {
    /**
     * `/ws/agent`: an agent that dials in. It presents the identity it was issued at
     * registration -- the id of its domain controller and its token -- and both have to name
     * the same agent. What follows is the same session as for an agent the server dials.
     */
    static handleAgentConnection(socket: WebSocket, req: FastifyRequest<AgentQuery>, fastify: FastifyInstance) {
        // Before the check below, which closes the socket and returns: the heartbeat's own
        // close handler is what clears its timer.
        attachHeartbeat(socket);

        const { clientId, token } = req.query ?? {};
        const dcId = clientId && token ? DcAgentService.authenticateInbound(clientId, token) : null;
        if (!dcId) {
            fastify.log.warn({ ip: req.ip, clientId }, "An agent connected without an identity this server issued");
            socket.close(4001, "Unauthorized");
            return;
        }
        socket.on("error", (err) => {
            fastify.log.warn({ dcId, err: err.message }, "Agent socket error");
            socket.close();
        });
        DcAgentService.attach(dcId, socket, "inbound");
    }

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

        DashboardHub.add(socket, userId);

        // What a dashboard starts from: the domain controllers, what is known of each, the
        // name servers that are none, and the activity. Everything after this is a change
        // to one of the four.
        DashboardHub.send(socket, {
            type: WS_EVENTS.DOMAIN_CONTROLLERS_UPDATE,
            payload: DomainControllerService.list(),
        });

        for (const health of DcHealthService.getAll()) {
            DashboardHub.send(socket, {
                type: WS_EVENTS.DC_HEALTH_UPDATE,
                payload: health,
            });
        }

        DashboardHub.send(socket, {
            type: WS_EVENTS.DNS_SERVERS_UPDATE,
            payload: DnsServerHealthService.getAll(),
        });

        DashboardHub.send(socket, {
            type: WS_EVENTS.ACTIVITY_UPDATE,
            payload: ActivityService.list(userId),
        });

        socket.on("close", () => {
            DashboardHub.remove(socket);
        });
    }
}
