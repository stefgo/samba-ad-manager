import { WebSocket } from "ws";
import {
    WS_EVENTS,
    CLIENT_STATUS,
    CONNECTION_MODE,
    type DashboardMessage,
} from "@sadm/shared";
import { logger } from "@sadm/shared/node";
import { ClientRepository } from "../repositories/ClientRepository.js";

export class ProxyService {
    private static connectedClients = new Map<string, WebSocket>();
    /** Each dashboard socket with the id of the user whose session opened it. */
    private static dashboardClients = new Map<WebSocket, number>();
    /**
     * What each connected agent said it can do, from its AUTH payload. Kept with the
     * connection rather than in the database: it describes the build that is on the wire
     * right now, and an agent updated while it was offline must not be credited with what
     * its predecessor could do.
     */
    private static clientCapabilities = new Map<string, Set<string>>();

    /**
     * Told whenever an agent connects or its connection ends. A listener rather than a call
     * into the service that cares, which would import this one right back.
     */
    private static connectionListeners: ((clientId: string) => void)[] = [];

    static onConnectionChange(listener: (clientId: string) => void): void {
        this.connectionListeners.push(listener);
    }

    private static notifyConnectionChange(clientId: string): void {
        for (const listener of this.connectionListeners) listener(clientId);
    }

    static registerClient(clientId: string, socket: WebSocket, capabilities: string[] = []) {
        const existing = this.connectedClients.get(clientId);
        if (existing) {
            existing.close(4000, "Replaced by new connection");
        }
        this.connectedClients.set(clientId, socket);
        this.clientCapabilities.set(clientId, new Set(capabilities));
        this.notifyConnectionChange(clientId);
    }

    /** Whether the agent currently connected under this id declared that capability. */
    static hasCapability(clientId: string, capability: string): boolean {
        return this.clientCapabilities.get(clientId)?.has(capability) ?? false;
    }

    /**
     * Everything the agent currently connected under this id declared, or `null` if none
     * is connected. For reporting the answer onwards; a server-side decision asks
     * `hasCapability` about the one capability it needs.
     */
    static getCapabilities(clientId: string): string[] | null {
        const capabilities = this.clientCapabilities.get(clientId);
        return capabilities ? [...capabilities] : null;
    }

    static getConnectedClientIds(): string[] {
        return [...this.connectedClients.keys()];
    }

    /**
     * Called when an agent's socket closes. A socket that has already been replaced by a
     * newer one leaves the entry alone -- it belongs to its successor now.
     */
    static unregisterClient(clientId: string, socket: WebSocket) {
        if (this.connectedClients.get(clientId) === socket) {
            this.connectedClients.delete(clientId);
            this.clientCapabilities.delete(clientId);
            this.notifyConnectionChange(clientId);
        }
    }

    static addDashboardClient(socket: WebSocket, userId: number) {
        this.dashboardClients.set(socket, userId);
    }

    static removeDashboardClient(socket: WebSocket) {
        this.dashboardClients.delete(socket);
    }

    /**
     * Closes every dashboard socket of a user whose sessions were just revoked.
     *
     * 4001 makes the dashboard give up instead of reconnecting (WebSocketProvider). A user
     * who changed their own password passes `renewed`: the response that did it carries a
     * fresh cookie, so their dashboard closes with 4002 and reconnects on that cookie.
     */
    static closeDashboardSessions(userId: number, renewed = false) {
        for (const [socket, owner] of this.dashboardClients) {
            if (owner !== userId) continue;
            if (renewed) {
                socket.close(4002, "Session renewed");
            } else {
                socket.close(4001, "Session is no longer valid");
            }
        }
    }

    static getClientSocket(clientId: string): WebSocket | undefined {
        return this.connectedClients.get(clientId);
    }

    static getClientsWithStatus() {
        const clients = ClientRepository.findAll();
        return clients.map((client) => ({
            id: client.id,
            // The column is nullable, though every insert writes one. The contract says a
            // string, and the dashboard searches and sorts by it.
            hostname: client.hostname ?? "",
            displayName: client.display_name,
            site: client.site,
            status: this.connectedClients.has(client.id)
                ? CLIENT_STATUS.ONLINE
                : CLIENT_STATUS.OFFLINE,
            lastSeen: client.last_seen,
            version: client.version,
            connectionMode: client.connection_mode ?? CONNECTION_MODE.INBOUND,
            inboundAllowedIp: client.inbound_allowed_ip,
            inboundLastIp: client.inbound_last_ip,
            outboundTargetAddress: client.outbound_target_address ?? null,
            /**
             * Only meaningful while the agent is connected: what it can do is a property of
             * the build on the wire, not of the stored client. `null` for an offline one is
             * "not known right now", which is the honest answer and reads differently in the
             * list from an empty list -- a connected agent that can do none of it.
             */
            capabilities: this.connectedClients.has(client.id)
                ? this.getCapabilities(client.id) ?? []
                : null,
            createdAt: client.created_at,
            updatedAt: client.updated_at,
        }));
    }

    /**
     * Broadcasts the complete list of registered clients and their online status
     * to all active dashboard WebSocket sessions.
     */
    static broadcastClientUpdate() {
        try {
            this.broadcastToDashboard({
                type: WS_EVENTS.CLIENTS_UPDATE,
                payload: this.getClientsWithStatus(),
            });
        } catch (e) {
            logger.error({ err: e }, "Broadcast error");
        }
    }

    /**
     * `DashboardMessage` and nothing else: the union in `@sadm/shared` is the contract the
     * dashboard parses against, so a shape that is not listed there does not compile here.
     */
    static sendToDashboard(socket: WebSocket, message: DashboardMessage) {
        socket.send(JSON.stringify(message));
    }

    static broadcastToDashboard(message: DashboardMessage) {
        // Serialised once for all connected dashboard sessions.
        const msgStr = JSON.stringify(message);
        for (const client of this.dashboardClients.keys()) {
            if (client.readyState === client.OPEN) {
                client.send(msgStr);
            }
        }
    }

    /**
     * Sends to every dashboard session of one user -- for what only that user's view
     * depends on, such as which events they have seen. Other users' sessions get nothing.
     */
    static sendToUser(userId: number, message: DashboardMessage) {
        const msgStr = JSON.stringify(message);
        for (const [client, owner] of this.dashboardClients) {
            if (owner === userId && client.readyState === client.OPEN) {
                client.send(msgStr);
            }
        }
    }

    /**
     * Sends a one-way message to a client agent without waiting for a response.
     */
    static sendFireAndForget(clientId: string, type: string, payload: unknown) {
        const socket = this.connectedClients.get(clientId);
        if (!socket) throw new Error("Client not connected");
        socket.send(JSON.stringify({ type, payload }));
    }
}
