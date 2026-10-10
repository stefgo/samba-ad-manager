import { createContext, useContext } from "react";

export interface SessionUser {
    /** A number, like `users.id`. */
    id: number;
    username: string;
}

export interface AuthContextType {
    /**
     * Whether a session exists -- not the session itself. The JWT lives in an httpOnly
     * cookie that no script can read, so there is no token to hand around.
     */
    isAuthenticated: boolean;
    /** From /api/v1/me once it has answered; null before that and when signed out. */
    user: SessionUser | null;
    /** Called after the login request succeeded; the server has already set the cookies. */
    login: () => void;
    logout: () => void;
}

// Kept in a JSX-free module of its own: a file that exports the provider *and* this
// hook mixes component and non-component exports, which costs Fast Refresh for every
// consumer of the context. The provider lives in AuthProvider.tsx.
export const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
};
