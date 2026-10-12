import { WebSocket } from "ws";

/**
 * The agents that are connected right now: one socket per domain controller, whichever side
 * dialled. The one way anything is sent to an agent.
 */
export class AgentHub {
    private static sockets = new Map<string, WebSocket>();

    /** Takes over the connection of a domain controller's agent. One that was there before is closed: there is one agent. */
    static register(dcId: string, socket: WebSocket): void {
        const previous = this.sockets.get(dcId);
        this.sockets.set(dcId, socket);
        if (previous && previous !== socket) {
            try {
                previous.close(4000, "Replaced by new connection");
            } catch {
                // Already closing.
            }
        }
    }

    /** Forgets a socket that closed. Whether it was the current one -- a replaced socket closing must not mark its successor gone. */
    static unregister(dcId: string, socket: WebSocket): boolean {
        if (this.sockets.get(dcId) !== socket) return false;
        this.sockets.delete(dcId);
        return true;
    }

    static isConnected(dcId: string): boolean {
        return this.sockets.get(dcId)?.readyState === WebSocket.OPEN;
    }

    /** Sends one message. Whether it went out. */
    static send(dcId: string, type: string, payload: unknown = {}): boolean {
        const socket = this.sockets.get(dcId);
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify({ type, payload }));
        return true;
    }

    /** Closes the connection of an agent that is no longer one. */
    static disconnect(dcId: string, reason: string): void {
        const socket = this.sockets.get(dcId);
        if (!socket) return;
        this.sockets.delete(dcId);
        try {
            socket.close(4003, reason);
        } catch {
            // Already closing.
        }
    }
}
