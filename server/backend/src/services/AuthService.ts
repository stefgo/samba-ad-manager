import bcrypt from "bcryptjs";
import * as client from "openid-client";
import {
    appConfig,
    getEnabledOidcSettings,
    getOidcConfig,
} from "../config/AppConfig.js";
import { logger } from "../core/logger.js";
import { UserRepository, type UserRow } from "../repositories/UserRepository.js";

// State store for PKCE
const authStates = new Map<string, { code_verifier: string }>();

export class AuthService {
    static async initializeAdmin() {
        const userCount = UserRepository.countAll();
        // If no users exist, create a default admin account strictly for initial setup.
        // Password hash is pre-calculated for 'admin'.
        // Auth methods depend on configuration (local only or local+oidc).
        if (userCount === 0) {
            const hashedPassword = bcrypt.hashSync("admin", 10);
            const authMethods = appConfig.oidc?.enabled
                ? "local,oidc"
                : "local";
            UserRepository.create("admin", hashedPassword, authMethods);
            // warn, not info: this is a known-credentials account on a server that can change
            // the directory, and it stays that way until somebody acts on this line.
            logger.warn(
                `Default admin user created with the password 'admin' (allowed: ${authMethods}). ` +
                    "Change it after the first login.",
            );
        }
    }

    /**
     * Whether a verified session token still stands for a user as they are now.
     *
     * The signature only proves that this server issued the token. A deleted user, a changed
     * password or changed auth methods all leave it valid until it expires -- 12 hours by
     * default -- so the REST hook and the dashboard handshake both ask here as well. A token
     * from before `tv` existed carries none and is refused: one login after the update.
     */
    static isSessionCurrent(payload: { id?: unknown; tv?: unknown }): boolean {
        if (typeof payload.id !== "number" || typeof payload.tv !== "number") {
            return false;
        }
        const user = UserRepository.findById(String(payload.id));
        return !!user && user.token_version === payload.tv;
    }

    static checkLocalAuth(
        username: string,
        password: string,
    ): { user: UserRow; error?: undefined } | { user: null; error: string } {
        const user = UserRepository.findByUsername(username);

        // password_hash is nullable: an OIDC-only account has none. bcrypt.compareSync
        // throws on null instead of returning false, which turned a login attempt against
        // such an account into a 500 -- and a 500 instead of a 401 told the caller that
        // the account exists.
        if (
            user &&
            user.password_hash &&
            bcrypt.compareSync(password, user.password_hash)
        ) {
            if (user.auth_methods && !user.auth_methods.includes("local")) {
                return {
                    user: null,
                    error: "Local authentication not allowed for this user",
                };
            }
            return { user };
        }
        return { user: null, error: "Invalid credentials" };
    }

    static getAuthConfig() {
        return { type: getOidcConfig() ? "oidc" : "local" };
    }

    static async generateOidcUrl() {
        const oidcConfig = getOidcConfig();
        const oidc = getEnabledOidcSettings();
        if (!oidcConfig || !oidc) throw new Error("OIDC not configured");

        // Generate PKCE code verifier and challenge for secure authorization.
        // This prevents authorization code interception attacks.
        const code_verifier = client.randomPKCECodeVerifier();
        const code_challenge =
            await client.calculatePKCECodeChallenge(code_verifier);
        const state = client.randomState();

        authStates.set(state, { code_verifier });
        setTimeout(() => authStates.delete(state), 60000);

        return client
            .buildAuthorizationUrl(oidcConfig, {
                redirect_uri: oidc.redirect_uri,
                scope: "openid profile groups email",
                state,
                code_challenge,
                code_challenge_method: "S256",
            })
            .toString();
    }

    static async handleOidcCallback(currentUrl: URL) {
        const oidcConfig = getOidcConfig();
        const oidc = getEnabledOidcSettings();
        if (!oidcConfig || !oidc) throw new Error("OIDC not configured");

        const state = currentUrl.searchParams.get("state");
        if (!state || !authStates.has(state)) {
            throw new Error("Invalid state or session expired");
        }

        const { code_verifier } = authStates.get(state)!;
        authStates.delete(state);

        const tokens = await client.authorizationCodeGrant(
            oidcConfig,
            currentUrl,
            {
                pkceCodeVerifier: code_verifier,
                expectedState: state,
            },
            {
                redirect_uri: oidc.redirect_uri,
            },
        );

        let claims = tokens.claims();
        if (!claims) throw new Error("No claims found");

        if (tokens.access_token) {
            try {
                const userinfo = await client.fetchUserInfo(
                    oidcConfig,
                    tokens.access_token,
                    claims.sub,
                );
                claims = { ...claims, ...userinfo };
            } catch (e) {
                logger.warn({ err: e }, "Failed to fetch userinfo");
            }
        }

        const username = (claims.preferred_username ||
            claims.email ||
            claims.sub) as string;

        // Find user
        const user = UserRepository.findByUsername(username);
        if (!user) {
            throw new Error("User not found");
        }

        if (user.auth_methods && !user.auth_methods.includes("oidc")) {
            throw new Error("OIDC authentication not allowed for this user");
        }

        // `username` is nullable on the row, but this row was found by that very username,
        // so here it is not. Said in the return value rather than asserted by the caller,
        // which signs it into a JWT and cannot know the lookup already guaranteed it.
        return { ...user, username };
    }
}
