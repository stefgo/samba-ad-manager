import { FastifyReply, FastifyRequest } from "fastify";
import { LoginPayloadSchema, firstIssue } from "@sadm/shared";
import { AuthService } from "../services/AuthService.js";
import { getEnabledOidcSettings } from "../config/AppConfig.js";
import { setSessionCookies, clearSessionCookies } from "../services/SessionCookie.js";

export class AuthController {
    static async login(request: FastifyRequest, reply: FastifyReply) {
        // 400, not 401: a body without credentials is a malformed request, and answering it
        // with "invalid credentials" would suggest the input had been considered.
        const parsed = LoginPayloadSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }
        const { username, password } = parsed.data;
        const result = AuthService.checkLocalAuth(username, password);

        if (!result.user) {
            return reply.code(401).send({ error: result.error });
        }

        const token = request.server.jwt.sign({
            username,
            id: result.user.id,
            tv: result.user.token_version,
        });
        setSessionCookies(request, reply, token);
        // The token is deliberately not in the body: handing it to the page would put it
        // back within JavaScript's reach, which is what the httpOnly cookie is for.
        return { success: true };
    }

    /**
     * Ends the browser session. An endpoint at all only because the session cookie is
     * httpOnly -- the page cannot delete it itself.
     */
    static async logout(request: FastifyRequest, reply: FastifyReply) {
        clearSessionCookies(reply);
        return { success: true };
    }

    static async getConfig(_request: FastifyRequest, _reply: FastifyReply) {
        return AuthService.getAuthConfig();
    }

    /**
     * Who the current session belongs to, and until when it is valid.
     *
     * The dashboard used to base64-decode this out of the JWT itself -- the username for
     * the header, the id for the notifications' seen state, exp for the automatic logout.
     * With the token in an httpOnly cookie it cannot, and the answer belongs to the server
     * that issued the session anyway.
     */
    static async me(request: FastifyRequest, _reply: FastifyReply) {
        const { id, username, exp } = request.user;
        return {
            id,
            username,
            expiresAt: typeof exp === "number" ? new Date(exp * 1000).toISOString() : null,
        };
    }

    static async oidcLogin(request: FastifyRequest, reply: FastifyReply) {
        try {
            const url = await AuthService.generateOidcUrl();
            return reply.redirect(url);
        } catch (e: unknown) {
            return reply
                .code(404)
                .send({ error: e instanceof Error ? e.message : String(e) });
        }
    }

    static async oidcCallback(request: FastifyRequest, reply: FastifyReply) {
        try {
            // Reconstruct URL. helper needed?
            // Fastify request.url only gives path. Need host.
            // But we know redirect_uri from config.
            const oidc = getEnabledOidcSettings();
            if (!oidc) {
                throw new Error("OIDC is not configured or disabled");
            }
            const redirectUriObj = new URL(oidc.redirect_uri);
            const currentUrl = new URL(request.url, redirectUriObj.origin);

            const user = await AuthService.handleOidcCallback(currentUrl);
            const token = request.server.jwt.sign({
                username: user.username,
                id: user.id,
                tv: user.token_version,
            });

            // The token rides back in the cookie, not in the redirect target. As a query
            // parameter it was written into the browser history and into every proxy and
            // server access log on the way, and stayed valid for its full lifetime.
            setSessionCookies(request, reply, token);
            return reply.redirect("/");
        } catch (e: unknown) {
            return reply.code(500).send({
                error:
                    "Authentication failed: " +
                    (e instanceof Error ? e.message : String(e)),
            });
        }
    }
}
