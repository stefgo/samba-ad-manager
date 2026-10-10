import { createContext, useContext } from "react";

export interface WebSocketContextType {
    isConnected: boolean;
    /**
     * The socket has been down for longer than a reconnect takes. What the page shows is
     * no longer kept current -- the frontend does not poll -- and it has to say so.
     */
    isLost: boolean;
}

// JSX-free by design -- see AuthContext.ts. The provider lives in WebSocketProvider.tsx.
export const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
    return useContext(WebSocketContext);
};
