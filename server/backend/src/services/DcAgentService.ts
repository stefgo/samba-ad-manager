import { WebSocket } from "ws";
import {
    AGENT_CAPABILITIES,
    AGENT_EVENTS,
    type ActivityLevel,
    type AgentAuthPayload,
    type AgentMessage,
    type AgentRegistration,
    type ConnectionMode,
    type CreatedAgentToken,
    type DcAgent,
    type DcDbcheck,
} from "@sadm/shared";
import { appConfig, directoryConfig } from "../config/AppConfig.js";
import { logger } from "../core/logger.js";
import { AgentHub } from "../agent/AgentHub.js";
import { attachAgentSession } from "../agent/AgentSession.js";
import { openAgentSocket, registerAgent } from "../agent/agentDial.js";
import { REGISTRATION_TOKEN_TTL_MS, deriveOutboundToken, hashToken, newToken, reconnectDelay, sameHash } from "../agent/agentToken.js";
import { attachHeartbeat } from "../controllers/Heartbeat.js";
import { AgentRegistrationTokenRepository, DcAgentRepository, type DcAgentRow } from "../repositories/DcAgentRepository.js";
import { DomainControllerRepository } from "../repositories/DomainControllerRepository.js";
import { ActivityService } from "./ActivityService.js";
import { DcHealthService } from "./DcHealthService.js";

const capabilitiesOf = (row: DcAgentRow): string[] => {
    try {
        const parsed: unknown = JSON.parse(row.capabilities);
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
        return [];
    }
};

const sameDc = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Why the address of an agent was not set: there is none, or it is one that dials the server itself. */
export type AgentAddressRefusal = "no-agent" | "inbound";

/** Why something was not asked of an agent. `read-only` is a fix asked of a server that may change nothing. */
export type AgentRequestRefusal = "no-agent" | "offline" | "unsupported" | "read-only";

/**
 * The agents of the domain controllers: who may register, who is connected, and what they
 * are asked. An agent belongs to exactly one domain controller, which is how it is
 * identified everywhere -- there is no list of agents apart from the list of domain
 * controllers.
 *
 * What an agent may be asked is three things, none with a parameter: to report now, to run
 * the database check now, and to fix what the check finds. It runs as root next to the
 * directory's database, so nothing that a login of this application could turn into a
 * command is sent to it. The fix is the one request that writes, and it is held back twice:
 * the agent offers it only where its operator allowed it, and this server does not ask for
 * it while `directory.readOnly` is set.
 */
export class DcAgentService {
    private static listeners: (() => void)[] = [];
    private static reconnectTimers = new Map<string, NodeJS.Timeout>();
    private static reconnectAttempts = new Map<string, number>();

    /** Told whenever an agent was registered, removed, connected or lost: what the list of domain controllers shows of it changed. */
    static onChange(listener: () => void): void {
        this.listeners.push(listener);
    }

    private static changed(): void {
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                logger.warn({ err }, "A listener failed on a change of an agent");
            }
        }
    }

    /** A domain controller's agent as the API shows it, or null for one without. */
    static view(dcId: string): DcAgent | null {
        const row = DcAgentRepository.find(dcId);
        if (!row) return null;
        return {
            connectionMode: row.connection_mode === "outbound" ? "outbound" : "inbound",
            targetAddress: row.target_address,
            registeredAt: row.registered_at,
            connected: AgentHub.isConnected(dcId),
            lastSeen: row.last_seen,
            hostname: row.hostname,
            version: row.version,
            capabilities: capabilitiesOf(row),
        };
    }

    private static record(
        kind: "agent.registered" | "agent.updated" | "agent.removed" | "agent.dbcheck_fix_requested" | "agent.dbcheck_fixed",
        dcId: string,
        data: Record<string, unknown>,
        level: ActivityLevel = "info",
    ): void {
        const dc = DomainControllerRepository.findById(dcId);
        ActivityService.record({ kind, level, dcId, subject: { name: dc?.name ?? dcId }, data: { dcName: dc?.name ?? dcId, ...data } });
    }

    // ── Registration ─────────────────────────────────────────────────────────

    /**
     * Issues the token an agent that dials in registers with, in place of any issued for
     * this domain controller before. Returned once: only its hash is kept.
     */
    static issueToken(dcId: string): CreatedAgentToken | null {
        if (!DomainControllerRepository.findById(dcId)) return null;
        const now = Date.now();
        AgentRegistrationTokenRepository.deleteExpired(new Date(now).toISOString());
        const token = newToken();
        const expiresAt = new Date(now + REGISTRATION_TOKEN_TTL_MS).toISOString();
        AgentRegistrationTokenRepository.replace({
            token_hash: hashToken(token),
            dc_id: dcId,
            created_at: new Date(now).toISOString(),
            expires_at: expiresAt,
        });
        return { token, expiresAt };
    }

    /**
     * `POST /api/v1/register`: an agent presenting a registration token. The token names one
     * domain controller, and the agent says which one it runs on: the two have to agree, or
     * a token copied to the wrong host would report that host under the other's name.
     *
     * An agent that registers for a domain controller that has one takes its place -- that
     * is how one is brought back after its volume was lost.
     */
    static registerInbound(
        registration: AgentRegistration,
    ): { ok: true; token: string; clientId: string } | { ok: false; status: number; error: string } {
        const row = AgentRegistrationTokenRepository.find(hashToken(registration.token));
        if (!row || Date.parse(row.expires_at) <= Date.now()) {
            return { ok: false, status: 401, error: "The registration token is not valid, or no longer" };
        }
        const dc = DomainControllerRepository.findById(row.dc_id);
        if (!dc) return { ok: false, status: 401, error: "The registration token is not valid, or no longer" };
        if (!sameDc(registration.dcId, dc.id)) {
            logger.warn({ dc: dc.name, reported: registration.dcId }, "An agent tried to register with another domain controller's token");
            return { ok: false, status: 403, error: `This token was issued for ${dc.name}, which is not the domain controller this agent runs on` };
        }

        const token = newToken();
        this.forgetConnection(dc.id, "Registered again");
        DcAgentRepository.save({
            dc_id: dc.id,
            connection_mode: "inbound",
            auth_token_hash: hashToken(token),
            token_nonce: null,
            target_address: null,
            hostname: registration.hostname ?? null,
            registered_at: new Date().toISOString(),
        });
        AgentRegistrationTokenRepository.deleteFor(dc.id);
        logger.info({ dc: dc.name }, "An agent registered");
        this.record("agent.registered", dc.id, { connectionMode: "inbound", hostname: registration.hostname ?? null });
        this.changed();
        return { ok: true, token, clientId: dc.id };
    }

    /**
     * Has the server dial an agent that waits on its own port, register it with the setup
     * PIN from its log, and connect. Nothing is kept unless the agent accepted.
     */
    static async connectOutbound(dcId: string, targetAddress: string, registrationSecret: string): Promise<{ ok: true } | { ok: false; error: string }> {
        const dc = DomainControllerRepository.findById(dcId);
        if (!dc) return { ok: false, error: "No such domain controller" };

        const nonce = newToken();
        const authToken = deriveOutboundToken(appConfig.jwtSecret, dc.id, nonce);
        const registered = await registerAgent(
            targetAddress,
            { secret: registrationSecret, authToken, clientId: dc.id },
            appConfig.security.allow_self_signed_agent_certificates,
        );
        if (!registered.ok) return registered;

        this.forgetConnection(dc.id, "Registered again");
        DcAgentRepository.save({
            dc_id: dc.id,
            connection_mode: "outbound",
            auth_token_hash: hashToken(authToken),
            token_nonce: nonce,
            target_address: targetAddress,
            hostname: registered.hostname,
            registered_at: new Date().toISOString(),
        });
        AgentRegistrationTokenRepository.deleteFor(dc.id);
        logger.info({ dc: dc.name, targetAddress }, "An agent was registered");
        this.record("agent.registered", dc.id, { connectionMode: "outbound", hostname: registered.hostname });
        this.changed();
        // The first connection is waited for, so that the answer shows the agent as it then
        // stands. Registered it is either way; a connection that does not come about now is
        // tried again like any that is lost.
        await this.dial(dc.id);
        return { ok: true };
    }

    /**
     * Sets where the server dials an agent it reaches itself, and dials it there at once.
     * The agent stays the one it was: its token is derived from the nonce it registered
     * with, not from where it listens. Null when the address was taken, else why not.
     */
    static async setTargetAddress(dcId: string, targetAddress: string, actor: string | null): Promise<AgentAddressRefusal | null> {
        const row = DcAgentRepository.find(dcId);
        if (!row) return "no-agent";
        if (row.connection_mode !== "outbound") return "inbound";
        if (row.target_address === targetAddress) return null;

        DcAgentRepository.updateTargetAddress(dcId, targetAddress);
        // The connection that stands leads to the old address.
        this.forgetConnection(dcId, "Address changed");
        logger.info({ dcId, targetAddress }, "An agent's address was changed");
        this.record("agent.updated", dcId, { targetAddress, was: row.target_address, ...(actor ? { actor } : {}) });
        this.changed();
        // Waited for like the first connection, so that the answer shows the agent as it then stands.
        await this.dial(dcId);
        return null;
    }

    /** Takes the agent away from a domain controller, with what it reported. */
    static remove(dcId: string, actor: string | null): boolean {
        if (DcAgentRepository.delete(dcId).changes === 0) return false;
        this.forgetConnection(dcId, "Agent removed");
        AgentRegistrationTokenRepository.deleteFor(dcId);
        DcHealthService.clearAgentData(dcId);
        this.record("agent.removed", dcId, actor ? { actor } : {});
        this.changed();
        return true;
    }

    /** A domain controller the directory no longer lists: its rows went with it, its connection has to. */
    static forget(dcId: string): void {
        this.forgetConnection(dcId, "Domain controller removed");
    }

    private static forgetConnection(dcId: string, reason: string): void {
        const timer = this.reconnectTimers.get(dcId);
        if (timer) clearTimeout(timer);
        this.reconnectTimers.delete(dcId);
        this.reconnectAttempts.delete(dcId);
        AgentHub.disconnect(dcId, reason);
    }

    // ── Connections ──────────────────────────────────────────────────────────

    /**
     * The agent an inbound connection belongs to, by the identity it presents: both halves
     * have to name the same row, and the row has to be one that dials in.
     */
    static authenticateInbound(clientId: string, token: string): string | null {
        const row = DcAgentRepository.find(clientId.toLowerCase()) ?? DcAgentRepository.find(clientId);
        if (!row || row.connection_mode !== "inbound") return null;
        return sameHash(row.auth_token_hash, hashToken(token)) ? row.dc_id : null;
    }

    /**
     * Runs the session of an agent's socket, whichever side opened it. The heartbeat is the
     * caller's. `onReady` is told once the agent has said who it is and was accepted.
     */
    static attach(dcId: string, socket: WebSocket, connectionMode: ConnectionMode, onLost?: () => void, onReady?: () => void): void {
        attachAgentSession({
            dcId,
            socket,
            connectionMode,
            onAuthenticated: (auth) => {
                const refusal = this.authenticated(dcId, socket, auth);
                if (!refusal) onReady?.();
                return refusal;
            },
            onMessage: (message) => this.route(dcId, message),
            onClose: () => {
                DcAgentRepository.updateLastSeen(dcId, new Date().toISOString());
                // A socket that was replaced by a newer one is not an agent that went away.
                if (AgentHub.unregister(dcId, socket)) this.changed();
                onLost?.();
            },
        });
    }

    private static authenticated(dcId: string, socket: WebSocket, auth: AgentAuthPayload): string | null {
        // The identity travels with the volume it is stored on. Moved to another domain
        // controller, it would report that one under this one's name.
        if (!sameDc(auth.dcId, dcId)) {
            return "This agent's identity belongs to another domain controller. Delete identity.json in its data directory and register it again.";
        }
        DcAgentRepository.updateConnected(dcId, auth.hostname, auth.version ?? null, auth.capabilities, new Date().toISOString());
        AgentHub.register(dcId, socket);
        this.changed();
        return null;
    }

    /**
     * What an authenticated agent may send. An unknown type is dropped: an agent of a newer
     * build may know messages this server does not, and that is not an error on either side.
     */
    private static route(dcId: string, message: AgentMessage): void {
        switch (message.type) {
            case AGENT_EVENTS.LOCAL_REPORT:
                DcHealthService.storeLocal(dcId, message.payload);
                break;
            case AGENT_EVENTS.DBCHECK_REPORT:
                this.receiveDbcheck(dcId, message.payload);
                break;
            default:
                logger.debug({ dcId, type: message.type }, "Ignoring unknown agent message");
        }
    }

    /** Dials every agent the server reaches itself. After a start: nobody else would. */
    static connectAll(): void {
        for (const row of DcAgentRepository.findAll()) {
            if (row.connection_mode === "outbound") void this.dial(row.dc_id);
        }
    }

    /**
     * One attempt to reach an outbound agent; a failed one, and a lost connection, queue the
     * next. Settles once the agent has been accepted, or the attempt has come to nothing.
     */
    private static async dial(dcId: string): Promise<void> {
        const row = DcAgentRepository.find(dcId);
        if (!row || row.connection_mode !== "outbound" || !row.target_address || !row.token_nonce) return;
        if (AgentHub.isConnected(dcId)) return;

        const token = deriveOutboundToken(appConfig.jwtSecret, dcId, row.token_nonce);
        try {
            logger.debug({ dcId, address: row.target_address }, "Dialling an agent");
            const socket = await openAgentSocket(row.target_address, dcId, token, appConfig.security.allow_self_signed_agent_certificates);
            // Removed, or registered anew, while the dial was under way.
            if (DcAgentRepository.find(dcId)?.token_nonce !== row.token_nonce) {
                socket.close();
                return;
            }
            attachHeartbeat(socket);
            socket.on("error", (err) => {
                logger.warn({ dcId, err: err.message }, "Agent socket error");
                socket.close();
            });
            await new Promise<void>((settle) => {
                // Whatever ends the socket queues the next attempt: before the handshake
                // as well as after a connection that worked.
                socket.on("close", () => {
                    this.scheduleReconnect(dcId);
                    settle();
                });
                this.attach(dcId, socket, "outbound", undefined, () => {
                    // Reset once the agent was accepted, not on open: a socket that is
                    // dropped before the handshake is not a working connection.
                    this.reconnectAttempts.delete(dcId);
                    settle();
                });
            });
        } catch (err) {
            logger.debug({ dcId, err: err instanceof Error ? err.message : String(err) }, "Could not reach an agent");
            this.scheduleReconnect(dcId);
        }
    }

    private static scheduleReconnect(dcId: string): void {
        if (this.reconnectTimers.has(dcId)) return;
        const attempt = this.reconnectAttempts.get(dcId) ?? 0;
        this.reconnectAttempts.set(dcId, attempt + 1);
        const timer = setTimeout(() => {
            this.reconnectTimers.delete(dcId);
            void this.dial(dcId);
        }, reconnectDelay(attempt));
        timer.unref();
        this.reconnectTimers.set(dcId, timer);
    }

    // ── What an agent is asked ───────────────────────────────────────────────

    /** Asks an agent to report now. Silently nothing for a domain controller without one that is connected. */
    static requestReport(dcId: string): void {
        AgentHub.send(dcId, AGENT_EVENTS.REQUEST_REPORT);
    }

    /**
     * Keeps a database check an agent reported, and records how a fix went when the check
     * followed one: a change to a domain controller's database is in the activity like any
     * other, error or not.
     */
    static receiveDbcheck(dcId: string, payload: unknown): void {
        const dbcheck = DcHealthService.storeDbcheck(dcId, payload);
        if (dbcheck?.fix) this.recordFix(dcId, dbcheck);
    }

    private static recordFix(dcId: string, { fix, errors }: DcDbcheck): void {
        if (!fix) return;
        const level: ActivityLevel = fix.errorsFound === null ? "error" : errors === 0 ? "info" : "warning";
        this.record(
            "agent.dbcheck_fixed",
            dcId,
            { errorsFound: fix.errorsFound, errorsRemaining: errors, ...(fix.error ? { error: fix.error } : {}) },
            level,
        );
    }

    /** Asks an agent to run the database check now. Null when it was asked, else why not. */
    static requestDbcheck(dcId: string): Exclude<AgentRequestRefusal, "read-only"> | null {
        const row = DcAgentRepository.find(dcId);
        if (!row) return "no-agent";
        if (!AgentHub.isConnected(dcId)) return "offline";
        if (!capabilitiesOf(row).includes(AGENT_CAPABILITIES.DBCHECK)) return "unsupported";
        return AgentHub.send(dcId, AGENT_EVENTS.REQUEST_DBCHECK) ? null : "offline";
    }

    /**
     * Asks an agent to fix what its database check finds, and to check again after. Null
     * when it was asked, else why not. Who asked is recorded; how it went arrives with the
     * check that follows.
     */
    static requestDbcheckFix(dcId: string, actor: string | null): AgentRequestRefusal | null {
        // Before anything else: a server that may change nothing does not say whether it could.
        if (directoryConfig.readOnly) return "read-only";
        const row = DcAgentRepository.find(dcId);
        if (!row) return "no-agent";
        if (!AgentHub.isConnected(dcId)) return "offline";
        if (!capabilitiesOf(row).includes(AGENT_CAPABILITIES.DBCHECK_FIX)) return "unsupported";
        if (!AgentHub.send(dcId, AGENT_EVENTS.REQUEST_DBCHECK_FIX)) return "offline";
        logger.info({ dcId, actor }, "An agent was asked to fix its database");
        this.record("agent.dbcheck_fix_requested", dcId, actor ? { actor } : {});
        return null;
    }
}
