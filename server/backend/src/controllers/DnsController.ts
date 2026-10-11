import { FastifyReply, FastifyRequest } from "fastify";
import { DirectoryService } from "../services/DirectoryService.js";
import { answer, guidOf } from "./DirectoryController.js";

type ByGuid = { Params: { guid: string } };

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
}
