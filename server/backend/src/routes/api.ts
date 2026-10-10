import { FastifyInstance } from "fastify";
import { AuthController } from "../controllers/AuthController.js";
import { UserController } from "../controllers/UserController.js";
import { ClientController } from "../controllers/ClientController.js";
import { TokenController } from "../controllers/TokenController.js";
import { SettingsController } from "../controllers/SettingsController.js";
import { ActivityController } from "../controllers/ActivityController.js";
import { DcHealthController } from "../controllers/DcHealthController.js";
import { DirectoryController } from "../controllers/DirectoryController.js";
import { WebhookController } from "../controllers/WebhookController.js";
import { HealthRepository } from "../repositories/HealthRepository.js";
import { AuthService } from "../services/AuthService.js";

export default async function apiRoutes(fastify: FastifyInstance) {
    /**
     * Liveness for the container's HEALTHCHECK, the CI smoke test and monitoring.
     * Unauthenticated: a probe has no session, and the answer discloses nothing.
     *
     * Under /api on purpose. index.ts answers every path outside /api with the SPA's
     * index.html and HTTP 200, so a /health route that failed to register would keep
     * "succeeding" with an HTML body. Under /api an unknown path is a 404.
     *
     * Deliberately narrow: can this process serve requests and reach its database. Agent
     * connections are not consulted -- one offline agent must not mark the control plane
     * as broken.
     */
    fastify.get("/health", async (request, reply) => {
        try {
            HealthRepository.check();
            return { status: "ok" };
        } catch (err) {
            request.log.error({ err }, "Health check failed: database unreachable");
            return reply.code(503).send({ status: "error" });
        }
    });

    // Auth
    // The one unauthenticated endpoint that password guesses can be aimed at, and the
    // default admin/admin account exists until somebody changes it. Ten attempts per
    // quarter hour is far above what a person typing a password needs and far below
    // what guessing needs.
    fastify.post(
        "/login",
        {
            config: {
                rateLimit: { max: 10, timeWindow: "15 minutes" },
            },
        },
        AuthController.login,
    );
    // Unauthenticated on purpose: it only clears cookies, and requiring a valid session
    // would make an expired one impossible to log out of.
    fastify.post("/auth/logout", AuthController.logout);
    fastify.get("/auth/config", AuthController.getConfig);
    fastify.get("/auth/login", AuthController.oidcLogin);
    fastify.get("/auth/callback", AuthController.oidcCallback);

    // Register /api/v1 routes
    fastify.register(
        async (v1) => {
            // Protected Routes
            v1.register(async (protectedRoutes) => {
                protectedRoutes.addHook("onRequest", async (request, reply) => {
                    try {
                        await request.jwtVerify();
                    } catch (err) {
                        return reply.send(err);
                    }
                    // A valid signature is not enough: the user may have been deleted or
                    // had their password changed since the token was signed.
                    if (!AuthService.isSessionCurrent(request.user)) {
                        return reply
                            .code(401)
                            .send({ error: "Session is no longer valid" });
                    }
                });

                // The session's own identity. Behind the JWT hook like everything else here,
                // so an expired session answers 401 and the UI logs out through the same
                // path as for any other call.
                protectedRoutes.get("/me", AuthController.me);

                // Users
                protectedRoutes.get("/users", UserController.list);
                protectedRoutes.post("/users", UserController.create);
                protectedRoutes.put("/users/:userId", UserController.update);
                protectedRoutes.delete("/users/:userId", UserController.delete);

                // Clients
                protectedRoutes.get("/clients", ClientController.list);
                protectedRoutes.post("/clients/outbound", ClientController.createOutbound);
                protectedRoutes.delete(
                    "/clients/:clientId",
                    ClientController.delete,
                );
                protectedRoutes.put(
                    "/clients/:clientId",
                    ClientController.update,
                );
                protectedRoutes.post(
                    "/clients/:clientId/reconnect",
                    ClientController.reconnect,
                );

                // Registration Tokens
                protectedRoutes.get("/tokens", TokenController.list);
                protectedRoutes.post("/tokens", TokenController.create);
                protectedRoutes.delete(
                    "/tokens/:tokenHash",
                    TokenController.delete,
                );

                // Domain controller health -- what each agent last measured.
                protectedRoutes.get("/dc-health", DcHealthController.list);
                protectedRoutes.post("/clients/:clientId/health/refresh", DcHealthController.refresh);
                protectedRoutes.post("/clients/:clientId/health/dbcheck", DcHealthController.dbcheck);

                // The directory -- users, groups, computers and the containers they live in.
                // Each route asks a domain controller through its agent.
                protectedRoutes.get("/directory/status", DirectoryController.status);
                protectedRoutes.get("/directory/tree", DirectoryController.tree);
                protectedRoutes.get("/directory/children", DirectoryController.children);
                protectedRoutes.get("/directory/search", DirectoryController.search);

                protectedRoutes.get("/directory/users", DirectoryController.listUsers);
                protectedRoutes.post("/directory/users", DirectoryController.createUser);
                protectedRoutes.get("/directory/users/:guid", DirectoryController.getUser);
                protectedRoutes.put("/directory/users/:guid", DirectoryController.updateUser);
                protectedRoutes.post("/directory/users/:guid/password", DirectoryController.setPassword);
                protectedRoutes.post("/directory/users/:guid/unlock", DirectoryController.unlockUser);

                protectedRoutes.get("/directory/groups", DirectoryController.listGroups);
                protectedRoutes.post("/directory/groups", DirectoryController.createGroup);
                protectedRoutes.get("/directory/groups/:guid", DirectoryController.getGroup);
                protectedRoutes.put("/directory/groups/:guid", DirectoryController.updateGroup);
                protectedRoutes.post("/directory/groups/:guid/members", DirectoryController.addMembers);
                protectedRoutes.post("/directory/groups/:guid/members/remove", DirectoryController.removeMembers);

                protectedRoutes.get("/directory/computers", DirectoryController.listComputers);
                protectedRoutes.get("/directory/computers/:guid", DirectoryController.getComputer);
                protectedRoutes.put("/directory/computers/:guid", DirectoryController.updateComputer);

                protectedRoutes.post("/directory/ous", DirectoryController.createOu);
                protectedRoutes.put("/directory/ous/:guid", DirectoryController.updateOu);

                // What applies to an object of any kind, and to an account of either kind.
                protectedRoutes.post("/directory/accounts/:guid/enabled", DirectoryController.setEnabled);
                protectedRoutes.post("/directory/objects/:guid/move", DirectoryController.moveObject);
                protectedRoutes.post("/directory/objects/:guid/rename", DirectoryController.renameObject);
                protectedRoutes.delete("/directory/objects/:guid", DirectoryController.deleteObject);

                // Settings
                protectedRoutes.get(
                    "/settings/cleanup",
                    SettingsController.getSettings,
                );
                protectedRoutes.put(
                    "/settings/cleanup",
                    SettingsController.updateSettings,
                );
                protectedRoutes.post(
                    "/settings/cleanup/invalid-tokens",
                    SettingsController.runInvalidTokenCleanup,
                );
                protectedRoutes.get(
                    "/settings/scheduler-status",
                    SettingsController.getSchedulerStatus,
                );
                protectedRoutes.post(
                    "/settings/cleanup/notifications",
                    SettingsController.runNotificationCleanup,
                );

                // Activity -- what happened on the hosts and in the control plane.
                protectedRoutes.get("/activity", ActivityController.list);
                protectedRoutes.post("/activity/seen", ActivityController.markManySeen);
                protectedRoutes.delete("/activity", ActivityController.deleteAll);

                // Webhooks -- where events are reported to outside of the dashboard.
                protectedRoutes.get("/webhooks", WebhookController.list);
                protectedRoutes.post("/webhooks", WebhookController.create);
                // Registered before /webhooks/:webhookId, which it would otherwise look like.
                protectedRoutes.post("/webhooks/test", WebhookController.test);
                protectedRoutes.put("/webhooks/:webhookId", WebhookController.update);
                protectedRoutes.delete("/webhooks/:webhookId", WebhookController.delete);
            });

            // Register Client (Public but API)
            v1.post("/register", TokenController.register);

            // "Is there a SADM server at this URL?" -- the agent's status and register pages
            // ask this of its configured server. Not the same as /api/health, and the two must not be
            // merged: this one checks nothing on purpose, because a server with a broken
            // database is still reachable, and "no server here" would send the operator to
            // fix the wrong thing.
            v1.get("/ping", async () => {
                return { status: "ok" };
            });
        },
        { prefix: "/v1" },
    );
}
