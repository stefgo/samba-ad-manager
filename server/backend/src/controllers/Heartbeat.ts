import { WebSocket } from "ws";

/**
 * A socket carrying the liveness flag of the ping/pong heartbeat.
 *
 * `ws` has no place for it, so the heartbeat hangs it on the socket object. Declared
 * rather than cast at each use: the flag is written in one place and read in another
 * 30 seconds later, and a typo between the two would simply mean a dead connection is
 * never terminated.
 */
export interface HeartbeatSocket extends WebSocket {
    isAlive?: boolean;
}

/** How often a dashboard socket is pinged. */
const PING_INTERVAL_MS = 30000;

/**
 * Keeps a socket honest: pings every 30 seconds and terminates it if the pong for the
 * previous ping never arrived.
 *
 * The close handler is registered here, so a caller that closes the socket during its own
 * setup (an auth check that rejects, say) cannot leave the interval running.
 */
export function attachHeartbeat(socket: HeartbeatSocket): void {
    socket.isAlive = true;

    socket.on("pong", () => {
        socket.isAlive = true;
    });

    const interval = setInterval(() => {
        if (socket.isAlive === false) {
            socket.terminate();
            return;
        }
        socket.isAlive = false;
        socket.ping();
    }, PING_INTERVAL_MS);

    socket.on("close", () => clearInterval(interval));
}
