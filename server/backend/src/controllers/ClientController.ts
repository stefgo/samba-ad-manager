import { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "crypto";
import { ProxyService } from "../services/ProxyService.js";
import { ClientConnector } from "../services/ClientConnector.js";
import { ActivityService } from "../services/ActivityService.js";
import { ClientRepository } from "../repositories/ClientRepository.js";
import { secretKeyPersisted } from "../config/AppConfig.js";
import {
    CONNECTION_MODE,
    CreateOutboundClientSchema,
    UpdateClientSchema,
    firstIssue,
} from "@sadm/shared";

export class ClientController {
    /**
     * Retrieves a list of all clients combined with their live WebSocket connection status.
     */
    static async list(_request: FastifyRequest, _reply: FastifyReply) {
        return ProxyService.getClientsWithStatus();
    }

    /**
     * Attempts registration and AUTH handshake with the client first.
     * Only writes to the database if the connection was fully established.
     */
    static async createOutbound(request: FastifyRequest, reply: FastifyReply) {
        const parsed = CreateOutboundClientSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }
        const { hostname, outboundTargetAddress, registrationSecret } = parsed.data;

        // The token is stored encrypted, and that happens only after the agent has accepted
        // the registration. Failing there would leave an agent that counts itself as
        // registered and a server that has no row for it -- so refuse before the handshake.
        if (!secretKeyPersisted()) {
            return reply.code(500).send({
                error: "secretKey could not be written to config.yaml — make the file writable and restart the server.",
            });
        }

        const id = randomUUID();
        const resolvedHostname = hostname?.trim() || outboundTargetAddress;

        const result = await ClientConnector.firstConnect(
            id,
            outboundTargetAddress,
            registrationSecret,
            (authToken, version) => {
                ClientRepository.createOutbound(id, resolvedHostname, outboundTargetAddress, authToken);
                // Outbound client: the server dialled it, so there is no remote address.
                ClientRepository.updateAuthSuccess(id, version, null);
                ActivityService.record({
                    kind: "client.registered",
                    level: "info",
                    clientId: id,
                    data: {
                        hostname: resolvedHostname,
                        connectionMode: CONNECTION_MODE.OUTBOUND,
                        address: outboundTargetAddress,
                        version,
                    },
                });
            },
        );

        if (!result.ok) {
            // The reason comes from the handshake with the agent (e.g. "already registered"),
            // so the operator can act on it instead of guessing.
            const reason = result.error ?? "Unknown error.";
            return reply.code(503).send({ error: `Could not establish connection to client. ${reason}` });
        }

        ProxyService.broadcastClientUpdate();
        return { id, hostname: resolvedHostname };
    }

    /**
     * Deletes a client from the database. If the client is currently connected,
     * immediately terminates their WebSocket session.
     */
    static async delete(request: FastifyRequest, reply: FastifyReply) {
        const { clientId } = request.params as { clientId: string };
        const client = ClientRepository.findById(clientId);

        if (!client) {
            return reply.code(404).send({ error: "Client not found" });
        }

        // Cancel any pending reconnects for outbound clients
        if (client.connection_mode === CONNECTION_MODE.OUTBOUND) {
            ClientConnector.disconnectClient(clientId);
        }

        const info = ClientRepository.delete(clientId);
        if (info.changes === 0) {
            return reply.code(404).send({ error: "Client not found" });
        }

        // Disconnect if online
        const socket = ProxyService.getClientSocket(clientId);
        if (socket) {
            socket.close(4000, "Client deleted");
            ProxyService.unregisterClient(clientId, socket);
        }

        ProxyService.broadcastClientUpdate();
        return { status: "deleted" };
    }

    /**
     * Triggers an immediate reconnect attempt for an offline outbound client.
     * Cancels any pending backoff timer and resets the attempt counter first.
     */
    static async reconnect(request: FastifyRequest, reply: FastifyReply) {
        const { clientId } = request.params as { clientId: string };
        const client = ClientRepository.findById(clientId);

        if (!client) {
            return reply.code(404).send({ error: "Client not found" });
        }

        if (client.connection_mode !== CONNECTION_MODE.OUTBOUND) {
            return reply.code(400).send({ error: "Client is not an outbound client" });
        }

        ClientConnector.disconnectClient(clientId);
        ClientConnector.connectClient(client);

        return { status: "reconnecting" };
    }

    /**
     * Updates a client's display name and site, for inbound clients the
     * address or network its connections must come from, and for outbound clients the
     * address the server dials. `inboundAllowedIp: null` switches that check off; an absent
     * key leaves it alone.
     */
    static async update(request: FastifyRequest, reply: FastifyReply) {
        const { clientId } = request.params as { clientId: string };
        const parsed = UpdateClientSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }
        const { displayName, site, inboundAllowedIp, outboundTargetAddress } = parsed.data;

        const client = ClientRepository.findById(clientId);
        if (!client) {
            return reply.code(404).send({ error: "Client not found" });
        }
        const isOutbound = client.connection_mode === CONNECTION_MODE.OUTBOUND;
        if (inboundAllowedIp !== undefined && isOutbound) {
            return reply.code(400).send({
                error: "inboundAllowedIp: Only inbound clients have an allowed address",
            });
        }
        if (outboundTargetAddress !== undefined && !isOutbound) {
            return reply.code(400).send({
                error: "outboundTargetAddress: Only outbound clients are dialled by the server",
            });
        }

        if (displayName !== undefined) {
            ClientRepository.updateDisplayName(clientId, displayName);
        }
        if (site !== undefined) {
            // The schema has trimmed it already; an empty site is no site.
            ClientRepository.updateSite(clientId, site || null);
        }
        if (inboundAllowedIp !== undefined) {
            ClientRepository.updateInboundAllowedIp(clientId, inboundAllowedIp);
        }

        // A changed address has to take effect now, not at the next backoff step: the open
        // socket still points at the old host, and leaving it up would mean the client shows
        // as online at an address the operator has just corrected.
        if (
            outboundTargetAddress !== undefined &&
            outboundTargetAddress !== client.outbound_target_address
        ) {
            ClientRepository.updateOutboundTargetAddress(clientId, outboundTargetAddress);

            const socket = ProxyService.getClientSocket(clientId);
            if (socket) {
                socket.close(4000, "Target address changed");
                ProxyService.unregisterClient(clientId, socket);
            }
            // Clears the pending reconnect and its attempt counter, so the new address is
            // dialled straight away rather than after the old ladder runs down.
            ClientConnector.disconnectClient(clientId);

            const updated = ClientRepository.findById(clientId);
            if (updated) {
                // Not awaited: the reply should not wait out a connection attempt to a host
                // that may be unreachable. A failure schedules its own reconnect.
                void ClientConnector.connectOrRegister(updated);
            }
        }

        ProxyService.broadcastClientUpdate();
        return { success: true };
    }
}
