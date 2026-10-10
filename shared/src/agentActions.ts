import { z } from "zod";
import {
    CreateDirectoryUserSchema,
    CreateGroupSchema,
    CreateOuSchema,
    DIRECTORY_OBJECT_TYPES,
    DirectoryComputerSchema,
    DirectoryContainerSchema,
    DirectoryGroupSchema,
    DirectoryRefSchema,
    DirectorySearchSchema,
    DirectoryUserSchema,
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
} from "./directory.js";

/**
 * What the server may ask an agent to do, and what the agent answers.
 *
 * A request names one action out of a fixed list. There is no action that runs a command:
 * the agent does what it implements and nothing a server -- or whoever took it over -- might
 * think of. Each action carries the schema of its payload and of its result, so both ends
 * check the same shapes.
 */

const byGuid = z.object({ guid: GuidSchema });
/**
 * What a change was made to, as the directory named it before the change: for the record of
 * who did what, which the server keeps and the request alone does not carry a name for.
 */
const done = z.object({
    name: z.string(),
    dn: z.string(),
    type: z.enum(DIRECTORY_OBJECT_TYPES).catch("other"),
});
/** The same for a new object, with the GUID its page is addressed by. */
const created = done.extend({ guid: z.string() });

/** Each action with the payload it takes and the result it gives. */
export const AGENT_ACTIONS = {
    /** Measure now and send the measurement, whether or not anything changed. */
    "health.refresh": {
        payload: z.object({}),
        result: z.object({}),
    },
    /** Run the database check now. Answers once it has finished, which may take minutes. */
    "health.dbcheck": {
        payload: z.object({}),
        result: z.object({ errors: z.number().int().nullable(), error: z.string().nullish() }),
    },

    // ── Directory: reading ───────────────────────────────────────────────────
    "directory.users.list": { payload: z.object({}), result: z.object({ users: z.array(DirectoryUserSchema) }) },
    "directory.user.get": { payload: byGuid, result: DirectoryUserSchema },
    "directory.groups.list": { payload: z.object({}), result: z.object({ groups: z.array(DirectoryGroupSchema) }) },
    "directory.group.get": { payload: byGuid, result: DirectoryGroupSchema },
    "directory.computers.list": {
        payload: z.object({}),
        result: z.object({ computers: z.array(DirectoryComputerSchema) }),
    },
    "directory.computer.get": { payload: byGuid, result: DirectoryComputerSchema },
    /** Every organizational unit and container of the domain, flat; the tree is built from `parentDn`. */
    "directory.tree": {
        payload: z.object({}),
        result: z.object({ baseDn: z.string(), containers: z.array(DirectoryContainerSchema) }),
    },
    /** What lives directly in a container, of any kind. */
    "directory.children": {
        payload: z.object({ dn: DnSchema }),
        result: z.object({ objects: z.array(DirectoryRefSchema) }),
    },
    /** Users, groups and computers whose name starts like the query: for a picker. */
    "directory.search": { payload: DirectorySearchSchema, result: z.object({ objects: z.array(DirectoryRefSchema) }) },

    // ── Directory: changing ──────────────────────────────────────────────────
    "directory.user.create": { payload: CreateDirectoryUserSchema, result: created },
    "directory.user.update": { payload: byGuid.extend({ changes: UpdateDirectoryUserSchema }), result: done },
    "directory.user.setPassword": { payload: byGuid.extend(SetPasswordSchema.shape), result: done },
    "directory.user.unlock": { payload: byGuid, result: done },
    /** A user or a computer account. */
    "directory.account.setEnabled": { payload: byGuid.extend(SetEnabledSchema.shape), result: done },
    "directory.group.create": { payload: CreateGroupSchema, result: created },
    "directory.group.update": { payload: byGuid.extend({ changes: UpdateGroupSchema }), result: done },
    "directory.group.addMembers": { payload: byGuid.extend(GroupMembersSchema.shape), result: done },
    "directory.group.removeMembers": { payload: byGuid.extend(GroupMembersSchema.shape), result: done },
    "directory.computer.update": { payload: byGuid.extend({ changes: UpdateComputerSchema }), result: done },
    "directory.ou.create": { payload: CreateOuSchema, result: created },
    "directory.ou.update": { payload: byGuid.extend({ changes: UpdateOuSchema }), result: done },
    /** Any object: into another container, under another name, or gone. */
    "directory.object.move": { payload: byGuid.extend(MoveObjectSchema.shape), result: done },
    "directory.object.rename": { payload: byGuid.extend(RenameObjectSchema.shape), result: done },
    "directory.object.delete": { payload: byGuid, result: done },
} as const;

export type AgentAction = keyof typeof AGENT_ACTIONS;
export type AgentActionPayload<A extends AgentAction> = z.input<(typeof AGENT_ACTIONS)[A]["payload"]>;
export type AgentActionResult<A extends AgentAction> = z.output<(typeof AGENT_ACTIONS)[A]["result"]>;

export const isAgentAction = (action: string): action is AgentAction =>
    Object.prototype.hasOwnProperty.call(AGENT_ACTIONS, action);

/** How long the server waits for an answer before it gives up on a request, per action. */
const DEFAULT_ACTION_TIMEOUT_MS = 30_000;

const ACTION_TIMEOUTS_MS: Partial<Record<AgentAction, number>> = {
    "health.dbcheck": 10 * 60_000,
    // A whole list of a large directory, page by page.
    "directory.users.list": 120_000,
    "directory.groups.list": 120_000,
    "directory.computers.list": 120_000,
};

export const agentActionTimeoutMs = (action: AgentAction): number => ACTION_TIMEOUTS_MS[action] ?? DEFAULT_ACTION_TIMEOUT_MS;

/** `AGENT_REQUEST`, server to agent. The payload is checked against the action's schema. */
export const AgentRequestSchema = z.object({
    requestId: z.string().min(1),
    action: z.string().min(1),
    payload: z.unknown(),
});

/**
 * Why an agent did not do what it was asked.
 *
 * - `unknown-action`: this agent does not implement the action -- an older build.
 * - `invalid`: the payload did not fit, or the action refuses these values.
 * - `forbidden`: the agent's own configuration does not allow it (read-only, protected object),
 *   or the directory denies it to the account the agent binds as.
 * - `not-found`: the object the request names does not exist (any more).
 * - `conflict`: what is asked for is already there -- a name that is taken, a member that is one.
 * - `failed`: it was tried, and the directory or Samba refused.
 */
export const AGENT_ERROR_CODES = ["unknown-action", "invalid", "forbidden", "not-found", "conflict", "failed"] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

/** `AGENT_RESPONSE`, agent to server: the result, or why there is none. */
export const AgentResponseSchema = z.object({
    requestId: z.string().min(1),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z
        .object({
            code: z.enum(AGENT_ERROR_CODES).catch("failed"),
            message: z.string(),
        })
        .optional(),
});

export type AgentRequest = z.infer<typeof AgentRequestSchema>;
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
