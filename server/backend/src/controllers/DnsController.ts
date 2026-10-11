import { FastifyReply, FastifyRequest } from "fastify";
import { CreateDnsRecordSchema, DeleteDnsRecordSchema, GuidSchema, UpdateDnsRecordSchema } from "@sadm/shared";
import { DirectoryService } from "../services/DirectoryService.js";
import { answer, body, guidOf } from "./DirectoryController.js";

type ByGuid = { Params: { guid: string } };
type ByNode = { Params: { guid: string; nodeGuid: string } };

/** The zone and the name a route names, or null once a 400 has been sent. */
function nodeOf(request: FastifyRequest<ByNode>, reply: FastifyReply): { zoneGuid: string; nodeGuid: string } | null {
    const zoneGuid = GuidSchema.safeParse(request.params.guid);
    const nodeGuid = GuidSchema.safeParse(request.params.nodeGuid);
    if (!zoneGuid.success || !nodeGuid.success) {
        void reply.code(400).send({ error: "Not an object id" });
        return null;
    }
    return { zoneGuid: zoneGuid.data, nodeGuid: nodeGuid.data };
}

/**
 * The DNS zones over REST. They are in the directory, so everything here goes through
 * `DirectoryService` like any other question about it: the same domain controller, the
 * same refusals when the directory is switched off or does not answer.
 */
export class DnsController {
    static async listZones(_request: FastifyRequest, reply: FastifyReply) {
        return answer(reply, async () => (await DirectoryService.readDns((dns) => dns.listZones())).zones);
    }

    static async getZone(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const guid = guidOf(request, reply);
        if (!guid) return reply;
        return answer(reply, () => DirectoryService.readDns((dns) => dns.getZone({ guid })));
    }

    static async createRecord(request: FastifyRequest<ByGuid>, reply: FastifyReply) {
        const zoneGuid = guidOf(request, reply);
        const input = zoneGuid && body(CreateDnsRecordSchema, request, reply);
        if (!zoneGuid || !input) return reply;
        return answer(reply, async () => {
            await DirectoryService.changeDns(request.user, "directory.dns_record_created", (dns) => dns.createRecord({ zoneGuid, ...input }));
            return { ok: true };
        });
    }

    static async updateRecord(request: FastifyRequest<ByNode>, reply: FastifyReply) {
        const node = nodeOf(request, reply);
        const input = node && body(UpdateDnsRecordSchema, request, reply);
        if (!node || !input) return reply;
        return answer(reply, async () => {
            await DirectoryService.changeDns(request.user, "directory.dns_record_updated", (dns) => dns.updateRecord({ ...node, ...input }));
            return { ok: true };
        });
    }

    static async deleteRecord(request: FastifyRequest<ByNode>, reply: FastifyReply) {
        const node = nodeOf(request, reply);
        const input = node && body(DeleteDnsRecordSchema, request, reply);
        if (!node || !input) return reply;
        return answer(reply, async () => {
            await DirectoryService.changeDns(request.user, "directory.dns_record_deleted", (dns) => dns.deleteRecord({ ...node, ...input }));
            return { ok: true };
        });
    }
}
