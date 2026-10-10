/**
 * Declaration merging for what @fastify/jwt puts on a request.
 *
 * Until this interface says otherwise, `request.user` is `unknown`, which is why the
 * controllers used to reach for `request.user as any`. The shape is not a guess: it is what
 * both `jwt.sign` calls in AuthController put into the token, and the two must stay in step.
 *
 * `id` is a number because `users.id` is INTEGER AUTOINCREMENT. Route parameters are
 * strings, so comparisons against one still have to bridge that gap.
 *
 * `tv` is the user's `token_version` at signing time. `AuthService.isSessionCurrent` honours
 * a token only while it still matches the row -- that is how a session ends before it expires.
 */
import "@fastify/jwt";

declare module "@fastify/jwt" {
    interface FastifyJWT {
        payload: { username: string; id: number; tv: number };
        // iat and exp are added by the signer, so a verified token carries them even though
        // the payload handed to sign() does not.
        user: { username: string; id: number; tv: number; iat?: number; exp?: number };
    }
}
