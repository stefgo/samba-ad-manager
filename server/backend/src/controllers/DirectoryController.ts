import { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import {
    CreateDirectoryUserSchema,
    CreateGroupSchema,
    CreateOuSchema,
    DirectorySearchSchema,
    DnSchema,
    GroupMembersSchema,
    GuidSchema,
    MoveObjectSchema,
    RenameObjectSchema,
    SetEnabledSchema,
    SetPasswordSchema,
    UpdateComputerSchema,
    UpdateDirectoryUserSchema,
    UpdateGroupSchema,
    UpdateOuSchema,
    firstIssue,
} from "@sadm/shared";
import { DirectoryService } from "../services/DirectoryService.js";
import { sendAgentError } from "./DcHealthController.js";

type ByGuid = { Params: { guid: string } };

/** The request's body against a schema: the parsed value, or null once a 400 has been sent. */
function body<S extends z.ZodType>(schema: S, request: FastifyRequest, reply: FastifyReply): z.output<S> | null {
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
        void reply.code(400).send({ error: firstIssue(parsed.error) });
        return null;
    }
    return parsed.data;
}

/** The `:guid` of the route, or null once a 400 has been sent. */
function guidOf(request: FastifyRequest<ByGuid>, reply: FastifyReply): string | null {
    const parsed = GuidSchema.safeParse(request.params.guid);
    if (!parsed.success) {
        void reply.code(400).send({ error: "Not an object id" });
        return null;
    }
    return parsed.data;
}

/** Runs a request to an agent and answers a refusal with its status and reason. */
async function answer<T>(reply: FastifyReply, work: () => Promise<T>): Promise<T | FastifyReply> {
    try {
        return await work();
    } catch (err) {
        return sendAgentError(reply, err);
    }
}

/**
 * The directory over REST. Every route checks what it was sent and hands it to
 * `DirectoryService`, which picks the domain controller and keeps the record of changes;
 * what the directory itself thinks of a request is the agent's answer, passed on.
 */
export class DirectoryController {
    static async status(_request: FastifyRequest, _reply: FastifyReply) {
        return DirectoryService.status();
    }

    // ── Users ────────────────────────────────────────────────────────────────

    static async listUsers(_request: FastifyRequest, reply: FastifyReply) {
        return answer(reply, async () => (await DirectoryService.read("directory.users.list", {})).users);
    }

    static async getUser(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        if (!guid) return reply;
        return answer(reply, () => DirectoryService.read("directory.user.get", { guid }));
    }

    static async createUser(request: FastifyRequest, reply: FastifyReply) {
        const input = body(CreateDirectoryUserSchema, request, reply);
        if (!input) return reply;
        return answer(reply, async () => {
            const created = await DirectoryService.change(request.user, "directory.user.create", input, "directory.user_created");
            return reply.code(201).send({ guid: created.guid });
        });
    }

    static async updateUser(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        const changes = guid && body(UpdateDirectoryUserSchema, request, reply);
        if (!guid || !changes) return reply;
        return answer(reply, async () => {
            await DirectoryService.change(request.user, "directory.user.update", { guid, changes }, "directory.user_updated", {
                attributes: Object.keys(changes),
            });
            return { ok: true };
        });
    }

    static async setPassword(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        const input = guid && body(SetPasswordSchema, request, reply);
        if (!guid || !input) return reply;
        return answer(reply, async () => {
            // The password is in the request to the agent and nowhere else: not in the record, not in a log.
            await DirectoryService.change(request.user, "directory.user.setPassword", { guid, ...input }, "directory.password_set", {
                mustChangePassword: input.mustChangePassword,
            });
            return { ok: true };
        });
    }

    static async unlockUser(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        if (!guid) return reply;
        return answer(reply, async () => {
            await DirectoryService.change(request.user, "directory.user.unlock", { guid }, "directory.user_unlocked");
            return { ok: true };
        });
    }

    /** A user or a computer account. */
    static async setEnabled(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        const input = guid && body(SetEnabledSchema, request, reply);
        if (!guid || !input) return reply;
        return answer(reply, async () => {
            await DirectoryService.change(
                request.user,
                "directory.account.setEnabled",
                { guid, enabled: input.enabled },
                input.enabled ? "directory.account_enabled" : "directory.account_disabled",
            );
            return { ok: true };
        });
    }

    // ── Groups ───────────────────────────────────────────────────────────────

    static async listGroups(_request: FastifyRequest, reply: FastifyReply) {
        return answer(reply, async () => (await DirectoryService.read("directory.groups.list", {})).groups);
    }

    static async getGroup(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        if (!guid) return reply;
        return answer(reply, () => DirectoryService.read("directory.group.get", { guid }));
    }

    static async createGroup(request: FastifyRequest, reply: FastifyReply) {
        const input = body(CreateGroupSchema, request, reply);
        if (!input) return reply;
        return answer(reply, async () => {
            const created = await DirectoryService.change(request.user, "directory.group.create", input, "directory.group_created");
            return reply.code(201).send({ guid: created.guid });
        });
    }

    static async updateGroup(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        const changes = guid && body(UpdateGroupSchema, request, reply);
        if (!guid || !changes) return reply;
        return answer(reply, async () => {
            await DirectoryService.change(request.user, "directory.group.update", { guid, changes }, "directory.group_updated", {
                attributes: Object.keys(changes),
            });
            return { ok: true };
        });
    }

    static async addMembers(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        const input = guid && body(GroupMembersSchema, request, reply);
        if (!guid || !input) return reply;
        return answer(reply, async () => {
            await DirectoryService.change(request.user, "directory.group.addMembers", { guid, members: input.members }, "directory.members_added", {
                members: input.members.length,
            });
            return { ok: true };
        });
    }

    static async removeMembers(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        const input = guid && body(GroupMembersSchema, request, reply);
        if (!guid || !input) return reply;
        return answer(reply, async () => {
            await DirectoryService.change(
                request.user,
                "directory.group.removeMembers",
                { guid, members: input.members },
                "directory.members_removed",
                { members: input.members.length },
            );
            return { ok: true };
        });
    }

    // ── Computers ────────────────────────────────────────────────────────────

    static async listComputers(_request: FastifyRequest, reply: FastifyReply) {
        return answer(reply, async () => (await DirectoryService.read("directory.computers.list", {})).computers);
    }

    static async getComputer(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        if (!guid) return reply;
        return answer(reply, () => DirectoryService.read("directory.computer.get", { guid }));
    }

    static async updateComputer(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        const changes = guid && body(UpdateComputerSchema, request, reply);
        if (!guid || !changes) return reply;
        return answer(reply, async () => {
            await DirectoryService.change(request.user, "directory.computer.update", { guid, changes }, "directory.computer_updated", {
                attributes: Object.keys(changes),
            });
            return { ok: true };
        });
    }

    // ── Containers ───────────────────────────────────────────────────────────

    static async tree(_request: FastifyRequest, reply: FastifyReply) {
        return answer(reply, () => DirectoryService.read("directory.tree", {}));
    }

    static async children(request: FastifyRequest<{ Querystring: { dn?: string } }>, reply: FastifyReply) {
        const dn = DnSchema.safeParse(request.query.dn);
        if (!dn.success) return reply.code(400).send({ error: "dn: Must be a distinguished name" });
        return answer(reply, async () => (await DirectoryService.read("directory.children", { dn: dn.data })).objects);
    }

    static async search(request: FastifyRequest<{ Querystring: { query?: string; types?: string } }>, reply: FastifyReply) {
        const parsed = DirectorySearchSchema.safeParse({
            query: request.query.query,
            types: request.query.types ? request.query.types.split(",") : undefined,
        });
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        return answer(reply, async () => (await DirectoryService.read("directory.search", parsed.data)).objects);
    }

    static async createOu(request: FastifyRequest, reply: FastifyReply) {
        const input = body(CreateOuSchema, request, reply);
        if (!input) return reply;
        return answer(reply, async () => {
            const created = await DirectoryService.change(request.user, "directory.ou.create", input, "directory.ou_created");
            return reply.code(201).send({ guid: created.guid });
        });
    }

    static async updateOu(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        const changes = guid && body(UpdateOuSchema, request, reply);
        if (!guid || !changes) return reply;
        return answer(reply, async () => {
            await DirectoryService.change(request.user, "directory.ou.update", { guid, changes }, "directory.ou_updated", {
                attributes: Object.keys(changes),
            });
            return { ok: true };
        });
    }

    // ── Any object ───────────────────────────────────────────────────────────

    static async moveObject(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        const input = guid && body(MoveObjectSchema, request, reply);
        if (!guid || !input) return reply;
        return answer(reply, async () => {
            await DirectoryService.change(request.user, "directory.object.move", { guid, parentDn: input.parentDn }, "directory.object_moved", {
                target: input.parentDn,
            });
            return { ok: true };
        });
    }

    static async renameObject(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        const input = guid && body(RenameObjectSchema, request, reply);
        if (!guid || !input) return reply;
        return answer(reply, async () => {
            await DirectoryService.change(request.user, "directory.object.rename", { guid, name: input.name }, "directory.object_renamed", {
                newName: input.name,
            });
            return { ok: true };
        });
    }

    static async deleteObject(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        if (!guid) return reply;
        return answer(reply, async () => {
            await DirectoryService.change(request.user, "directory.object.delete", { guid }, "directory.object_deleted");
            return { ok: true };
        });
    }
}
