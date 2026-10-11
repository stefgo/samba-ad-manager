import { FastifyInstance } from "fastify";
import { AuthController } from "../controllers/AuthController.js";
import { UserController } from "../controllers/UserController.js";
import { DomainControllerController } from "../controllers/DomainControllerController.js";
import { SettingsController } from "../controllers/SettingsController.js";
import { ActivityController } from "../controllers/ActivityController.js";
import { DcHealthController } from "../controllers/DcHealthController.js";
import { DirectoryController } from "../controllers/DirectoryController.js";
import { DnsController } from "../controllers/DnsController.js";
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
     * Deliberately narrow: can this process serve requests and reach its database. The
     * domain controllers are not consulted -- one that is down must not mark this server
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

                // Domain controllers -- the ones the directory lists. None is added or removed here.
                protectedRoutes.get("/domain-controllers", DomainControllerController.list);
                protectedRoutes.put("/domain-controllers/:id", DomainControllerController.update);
                protectedRoutes.post("/domain-controllers/measure", DomainControllerController.measureAll);
                protectedRoutes.post("/domain-controllers/:id/measure", DomainControllerController.measure);
                protectedRoutes.post("/domain-controllers/:id/report-token", DomainControllerController.issueReportToken);
                protectedRoutes.delete("/domain-controllers/:id/report-token", DomainControllerController.revokeReportToken);

                // Domain controller health -- what was last measured of each.
                protectedRoutes.get("/dc-health", DcHealthController.list);
                protectedRoutes.get("/dc-health/options", DcHealthController.options);
                protectedRoutes.get("/dc-health/name-servers", DcHealthController.nameServers);

                // The directory -- users, groups, computers and the containers they live in.
                // Each route asks a domain controller.
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

                protectedRoutes.get("/dns/zones", DnsController.listZones);
                protectedRoutes.get("/dns/zones/:guid", DnsController.getZone);
                protectedRoutes.post("/dns/zones/:guid/records", DnsController.createRecord);
                protectedRoutes.put("/dns/zones/:guid/nodes/:nodeGuid/records", DnsController.updateRecord);
                protectedRoutes.post("/dns/zones/:guid/nodes/:nodeGuid/records/delete", DnsController.deleteRecord);

                // Settings
                protectedRoutes.get(
                    "/settings/cleanup",
                    SettingsController.getSettings,
                );
                protectedRoutes.put(
                    "/settings/cleanup",
                    SettingsController.updateSettings,
                );
                protectedRoutes.get(
                    "/settings/scheduler-status",
                    SettingsController.getSchedulerStatus,
                );
                protectedRoutes.post(
                    "/settings/cleanup/notifications",
                    SettingsController.runNotificationCleanup,
                );

                // Activity -- what happened in the domain and on this server.
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

            // A domain controller reporting its database check. No session: the caller is a
            // script with a token of its own. Limited, because the token is all that is asked
            // for -- a check runs once a day, so this is far above what any of them needs.
            v1.post(
                "/dbcheck/report",
                { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } },
                DomainControllerController.reportDbcheck,
            );
        },
        { prefix: "/v1" },
    );
}
