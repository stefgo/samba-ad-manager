import { useEffect, useRef, useState, ReactNode } from "react";
import { WS_EVENTS } from "@sadm/shared";
import { useAuth } from "../../auth/AuthContext";
import { WebSocketContext } from "./WebSocketContext";
import { queryClient } from "../../../lib/queryClient";
import { assertNever, createDashboardMessageReader } from "../lib/dashboardMessages";
import { isPushedOnConnect } from "../../../lib/queryKeys";
import { clientListOptions } from "../../../queries/clients";
import {
    appendActivity,
    applySchedulerUpdate,
    markActivitySeen,
} from "../../../lib/cacheUpdates";
import { activityListOptions } from "../../../queries/activity";
import { schedulerStatusOptions } from "../../../queries/scheduler";

/**
 * How long the socket may be down before the page says so. A reconnect is scheduled 3 s
 * after a drop; a server restart is over within a few more. Anything shorter would flash
 * the banner at every deploy.
 */
const LOST_AFTER_MS = 5000;

/** Module scope, so "reported once" holds across reconnects and not per socket. */
const readMessage = createDashboardMessageReader();

interface WebSocketProviderProps {
    children: ReactNode;
}

export const WebSocketProvider = ({ children }: WebSocketProviderProps) => {
    const { isAuthenticated } = useAuth();
    const [isConnected, setIsConnected] = useState(false);
    const [isLost, setIsLost] = useState(false);
    const socketRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!isAuthenticated) return;

        let isClosing = false;
        let connectTimeout: ReturnType<typeof setTimeout> | null = null;
        // Per effect run: a login after a logout is a first connection again, not a resync.
        let hasConnected = false;
        let lostTimeout: ReturnType<typeof setTimeout> | null = null;

        const armLostTimer = () => {
            if (lostTimeout) return;
            lostTimeout = setTimeout(() => setIsLost(true), LOST_AFTER_MS);
        };
        const disarmLostTimer = () => {
            if (lostTimeout) clearTimeout(lostTimeout);
            lostTimeout = null;
        };

        const connect = () => {
            if (socketRef.current?.readyState === WebSocket.OPEN) return;

            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            // No token in the URL: the browser attaches the session cookie to the handshake
            // by itself. As a query parameter the JWT went into every access log on the way.
            const wsUrl = `${protocol}//${window.location.host}/ws/dashboard`;

            const socket = new WebSocket(wsUrl);
            socketRef.current = socket;

            socket.onopen = () => {
                setIsConnected(true);
                disarmLostTimer();
                setIsLost(false);
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = null;
                }
                // What the server pushed while the socket was down is lost. The client
                // list, the readings and the activity come again with this connect;
                // everything else on screen is read again, the rest marked stale and read
                // when it is next shown. On the first connect there is nothing to make up
                // for: whatever a page needs, its query reads.
                if (hasConnected) {
                    void queryClient.invalidateQueries({ predicate: (query) => !isPushedOnConnect(query.queryKey) });
                }
                hasConnected = true;
            };

            socket.onmessage = (event) => {
                // Parsed against the contract in @sadm/shared; what does not match is
                // dropped and reported once per type (see lib/dashboardMessages.ts).
                const message = readMessage(event.data);
                if (!message) return;

                switch (message.type) {
                    // The whole list, so it may also be what fills the entry first.
                    case WS_EVENTS.CLIENTS_UPDATE:
                        queryClient.setQueryData(clientListOptions.queryKey, message.payload);
                        break;
                    // The whole list: on connect, and empty after "Delete all".
                    case WS_EVENTS.ACTIVITY_UPDATE:
                        queryClient.setQueryData(activityListOptions.queryKey, message.payload);
                        break;
                    // Only onto a list that is there: the events alone would pass for all
                    // of it. The list itself arrives with the connect, before any of these.
                    case WS_EVENTS.ACTIVITY_APPENDED: {
                        const incoming = message.payload;
                        queryClient.setQueryData(
                            activityListOptions.queryKey,
                            (events) => events && appendActivity(events, incoming),
                        );
                        break;
                    }
                    case WS_EVENTS.ACTIVITY_SEEN: {
                        const { ids } = message.payload;
                        queryClient.setQueryData(
                            activityListOptions.queryKey,
                            (events) => events && markActivitySeen(events, ids),
                        );
                        break;
                    }
                    // One scheduler at a time. Only where the status has been read: an
                    // entry made here would hold one scheduler and pass for both.
                    case WS_EVENTS.SCHEDULER_STATUS_UPDATE: {
                        const update = message.payload;
                        queryClient.setQueryData(
                            schedulerStatusOptions.queryKey,
                            (schedulers) => schedulers && applySchedulerUpdate(schedulers, update),
                        );
                        break;
                    }
                    // Does not compile while a member of DashboardMessage has no case above.
                    default:
                        assertNever(message);
                }
            };

            socket.onclose = (event) => {
                if (isClosing) return; // Ignore intentional closure

                setIsConnected(false);
                armLostTimer();
                socketRef.current = null;

                // The server refused the session: asking again changes nothing. The next
                // request answers 401 and logs out; until then the banner says the page
                // is not being kept current.
                if (event.code === 4001 || event.code === 4003) return;

                reconnectTimeoutRef.current = setTimeout(() => {
                    connect();
                }, 3000);
            };

            socket.onerror = (err) => {
                if (isClosing) return; // Ignore errors during intentional closure
                console.error("WebSocket error", err);
                socket.close();
            };
        };

        // The first connection can fail too, and then there was never a drop to arm this.
        armLostTimer();

        // Delay initial connection slightly to avoid React Strict Mode noisy double-mount in dev
        connectTimeout = setTimeout(() => {
            if (!isClosing) connect();
        }, 100);

        return () => {
            isClosing = true;
            disarmLostTimer();
            setIsLost(false);
            if (connectTimeout) {
                clearTimeout(connectTimeout);
            }
            if (socketRef.current) {
                socketRef.current.onclose = null;
                socketRef.current.close();
                socketRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, [isAuthenticated]);

    return (
        <WebSocketContext.Provider value={{ isConnected, isLost }}>
            {children}
        </WebSocketContext.Provider>
    );
};
