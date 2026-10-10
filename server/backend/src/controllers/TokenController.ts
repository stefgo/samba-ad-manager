import { FastifyRequest, FastifyReply } from "fastify";
import crypto from "crypto";
import {
    CONNECTION_MODE,
    CreateTokenSchema,
    RegistrationPayloadSchema,
    firstIssue,
    normaliseIp,
} from "@sadm/shared";
import { TokenRepository } from "../repositories/TokenRepository.js";
import { ClientRepository } from "../repositories/ClientRepository.js";

import { ProxyService } from "../services/ProxyService.js";
import { ActivityService } from "../services/ActivityService.js";

export class TokenController {
    static async list(_request: FastifyRequest, _reply: FastifyReply) {
        const tokens = TokenRepository.findAll();
        // Only the hash leaves the server: the token itself was shown once, when it was issued.
        return tokens.map((t) => ({
            ...t,
            tokenHash: t.token_hash,
            createdAt: t.created_at,
            expiresAt: t.expires_at,
            usedAt: t.used_at,
            displayName: t.display_name,
            inboundAllowedIp: t.allowed_ip,
        }));
    }

    /**
     * Issues a registration token, optionally carrying what the agent cannot tell the
     * server about itself: the name to show it under and the address it may connect from.
     * A request without a body keeps the previous behaviour.
     */
    static async create(request: FastifyRequest, reply: FastifyReply) {
        // An absent body is a valid call, not a malformed one -- scripts that only ask for
        // a token predate the fields below.
        const parsed = CreateTokenSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }
        const displayName = parsed.data.displayName || null;
        const inboundAllowedIp = parsed.data.inboundAllowedIp || null;

        const token = crypto.randomBytes(16).toString("hex");
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        TokenRepository.create(token, expiresAt, displayName, inboundAllowedIp);
        // The one response that carries the token in the clear; only its hash is stored.
        return { token, expiresAt, displayName, inboundAllowedIp };
    }

    static async delete(request: FastifyRequest, reply: FastifyReply) {
        const { tokenHash } = request.params as { tokenHash: string };
        // A token that was not there is a 404, like every other delete: reporting "deleted"
        // for a token nobody holds hides a typo in the path as a success.
        const { changes } = TokenRepository.delete(tokenHash);
        if (changes === 0) {
            return reply.code(404).send({ error: "Token not found" });
        }
        return { status: "deleted" };
    }

    static async register(request: FastifyRequest, reply: FastifyReply) {
        // The one unauthenticated endpoint with a body, so its shape is checked first -- and
        // ahead of the token lookup, so a malformed request learns nothing from the status
        // code about whether the token it sent exists.
        const parsed = RegistrationPayloadSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }
        const { token } = parsed.data;
        const tokenRow = TokenRepository.findValidByToken(token);

        if (!tokenRow) {
            return reply.code(403).send({ error: "Invalid or expired token" });
        }

        try {
            const hostname = parsed.data.hostname || "unknown";

            // The server issues the identity, both halves of it. Taking the id from the caller
            // would let anyone holding a registration token name an existing client and have
            // its auth token replaced — impersonating that host from then on.
            const clientId = crypto.randomUUID();
            const authToken = crypto.randomBytes(64).toString("hex");

            // What the token fixed wins, because the operator who issued it knew where this
            // agent would sit; without it the client starts out restricted to the address it
            // registers from, and the client editor can widen or switch off either. The
            // observed address is normalised, so a dual-stack peer is stored as the IPv4
            // address it is. Behind a reverse proxy this is the forwarded address only if
            // the proxy is listed in security.trusted_proxies -- see docs/security.md.
            const allowedIp = tokenRow.allowed_ip || normaliseIp(request.ip);

            TokenRepository.markUsed(tokenRow.token_hash);

            ClientRepository.createInbound(clientId, hostname, authToken, allowedIp);

            // The display name is a separate column; the hostname stays what the agent
            // reported, so the list can still show both.
            if (tokenRow.display_name) {
                ClientRepository.updateDisplayName(clientId, tokenRow.display_name);
            }

            ActivityService.record({
                kind: "client.registered",
                level: "info",
                clientId,
                data: { hostname, connectionMode: CONNECTION_MODE.INBOUND, ip: allowedIp },
            });

            ProxyService.broadcastClientUpdate();

            return { token: authToken, clientId };
        } catch (e: unknown) {
            request.log.error({ err: e }, "Registration failed");
            return reply.code(500).send({ error: "Registration failed" });
        }
    }
}
