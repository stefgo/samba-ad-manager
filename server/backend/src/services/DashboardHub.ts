import { WebSocket } from "ws";
import type { DashboardMessage } from "@sadm/shared";

/**
 * The open dashboards, and the one way anything is pushed to them.
 *
 * `DashboardMessage` and nothing else: the union in `@sadm/shared` is the contract the
 * dashboard parses against, so a shape that is not listed there does not compile here.
 */
export class DashboardHub {
    /** Each dashboard socket with the id of the user whose session opened it. */
    private static sockets = new Map<WebSocket, number>();

    static add(socket: WebSocket, userId: number): void {
        this.sockets.set(socket, userId);
    }

    static remove(socket: WebSocket): void {
        this.sockets.delete(socket);
    }

    /**
     * Closes every dashboard socket of a user whose sessions were just revoked.
     *
     * 4001 makes the dashboard give up instead of reconnecting (WebSocketProvider). A user
     * who changed their own password passes `renewed`: the response that did it carries a
     * fresh cookie, so their dashboard closes with 4002 and reconnects on that cookie.
     */
    static closeSessions(userId: number, renewed = false): void {
        for (const [socket, owner] of this.sockets) {
            if (owner !== userId) continue;
            if (renewed) {
                socket.close(4002, "Session renewed");
            } else {
                socket.close(4001, "Session is no longer valid");
            }
        }
    }

    static send(socket: WebSocket, message: DashboardMessage): void {
        socket.send(JSON.stringify(message));
    }

    static broadcast(message: DashboardMessage): void {
        // Serialised once for all connected dashboard sessions.
        const text = JSON.stringify(message);
        for (const socket of this.sockets.keys()) {
            if (socket.readyState === socket.OPEN) socket.send(text);
        }
    }

    /**
     * Sends to every dashboard session of one user -- for what only that user's view
     * depends on, such as which events they have seen. Other users' sessions get nothing.
     */
    static sendToUser(userId: number, message: DashboardMessage): void {
        const text = JSON.stringify(message);
        for (const [socket, owner] of this.sockets) {
            if (owner === userId && socket.readyState === socket.OPEN) socket.send(text);
        }
    }
}
