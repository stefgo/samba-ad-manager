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

/** Server interval. The agent's own watchdog waits 35s — this plus a 5s margin. */
const PING_INTERVAL_MS = 30000;

/**
 * Keeps a socket honest: pings every 30 seconds and terminates it if the pong for the
 * previous ping never arrived.
 *
 * This existed three times in `WebSocketController` — once per connection kind — with
 * one real difference between the copies, which is now the `onTimeout` callback: only
 * the inbound agent connection logs why it dropped a peer. Three copies of a timing rule
 * is how the three quietly drift apart.
 *
 * The close handler is registered here, so a caller that closes the socket during its own
 * setup (an auth check that rejects, say) cannot leave the interval running.
 *
 * @param onTimeout Called just before terminating, for callers that want to say why.
 * @returns A stop function, for the rare caller that has to clear it before the close.
 */
export function attachHeartbeat(
    socket: HeartbeatSocket,
    onTimeout?: () => void,
): () => void {
    socket.isAlive = true;

    socket.on("pong", () => {
        socket.isAlive = true;
    });

    const interval = setInterval(() => {
        if (socket.isAlive === false) {
            onTimeout?.();
            socket.terminate();
            return;
        }
        socket.isAlive = false;
        socket.ping();
    }, PING_INTERVAL_MS);

    const stop = () => clearInterval(interval);
    socket.on("close", stop);
    return stop;
}
