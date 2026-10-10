import { z } from "zod";
import { GROUP_KINDS, GROUP_SCOPES, GUID_PATTERN } from "./adAttributes.js";
import { parseDn } from "./dn.js";

/**
 * The objects of the directory as this application shows and changes them: users, groups,
 * computers, and the organizational units and containers they live in.
 *
 * An object is addressed by its `objectGUID`. Its DN changes when it is renamed or moved --
 * by this application or by anything else that manages the directory -- and a page that
 * was open on it must not end up on another object, or on none.
 */

// ── Shapes the agent answers with ────────────────────────────────────────────

export const DIRECTORY_OBJECT_TYPES = ["user", "group", "computer", "ou", "container", "other"] as const;
export type DirectoryObjectType = (typeof DIRECTORY_OBJECT_TYPES)[number];

export const GuidSchema = z.string().regex(GUID_PATTERN, "Must be a GUID");

/** A DN that parses, and is not the root. */
export const DnSchema = z
    .string()
    .min(1)
    .max(2048)
    .refine((dn) => (parseDn(dn)?.length ?? 0) > 0, { error: "Must be a distinguished name" });

/** Just enough of an object to name it and link to it: a member, a child, a search hit. */
export const DirectoryRefSchema = z.looseObject({
    guid: z.string(),
    dn: z.string(),
    /** What a reader calls it: the account name for accounts and groups, else the object's name. */
    name: z.string(),
    type: z.enum(DIRECTORY_OBJECT_TYPES).catch("other"),
    /** A second line where the name alone is ambiguous: a display name, a description. */
    detail: z.string().nullish(),
});

/** What every object carries, whatever its kind. */
const BaseObjectSchema = z.looseObject({
    guid: z.string(),
    dn: z.string(),
    /** The DN of the container the object lives in. */
    parentDn: z.string(),
    /** The object's own name within that container: the value of its first RDN. */
    cn: z.string(),
    description: z.string().nullish(),
    whenCreated: z.string().nullish(),
    whenChanged: z.string().nullish(),
    /**
     * Whether the directory marks the object as one it cannot do without
     * (`isCriticalSystemObject`), or it is a domain controller's own account. Such an object
     * can be looked at, and is not deleted, disabled, renamed or moved from here.
     */
    protected: z.boolean().default(false),
});

export const DirectoryUserSchema = BaseObjectSchema.extend({
    sid: z.string().nullish(),
    accountName: z.string(),
    userPrincipalName: z.string().nullish(),
    displayName: z.string().nullish(),
    givenName: z.string().nullish(),
    surname: z.string().nullish(),
    mail: z.string().nullish(),
    enabled: z.boolean(),
    lockedOut: z.boolean(),
    passwordNeverExpires: z.boolean(),
    /** The user has to set a new password at the next logon. */
    mustChangePassword: z.boolean(),
    passwordLastSet: z.string().nullish(),
    /** Replicated at most every fortnight or so; the last logon on some domain controller, roughly. */
    lastLogon: z.string().nullish(),
    /** Null: never. */
    accountExpires: z.string().nullish(),
    /** The groups the user is a direct member of, the primary group first. Only on a single user. */
    memberOf: z.array(DirectoryRefSchema).nullish(),
});

export const DirectoryGroupSchema = BaseObjectSchema.extend({
    sid: z.string().nullish(),
    accountName: z.string(),
    mail: z.string().nullish(),
    scope: z.enum(GROUP_SCOPES),
    kind: z.enum(GROUP_KINDS),
    /** One of the directory's own groups under `CN=Builtin`. */
    builtin: z.boolean().default(false),
    /** Direct members, without those who have the group as their primary one. */
    memberCount: z.number().int(),
    /** Direct members, including those whose primary group this is. Only on a single group. */
    members: z.array(DirectoryRefSchema).nullish(),
    memberOf: z.array(DirectoryRefSchema).nullish(),
});

export const DirectoryComputerSchema = BaseObjectSchema.extend({
    sid: z.string().nullish(),
    accountName: z.string(),
    dnsHostName: z.string().nullish(),
    operatingSystem: z.string().nullish(),
    operatingSystemVersion: z.string().nullish(),
    enabled: z.boolean(),
    isDomainController: z.boolean(),
    passwordLastSet: z.string().nullish(),
    lastLogon: z.string().nullish(),
    memberOf: z.array(DirectoryRefSchema).nullish(),
});

export const DIRECTORY_CONTAINER_TYPES = ["domain", "ou", "container", "builtin"] as const;

/** A place objects live in: the domain itself, an organizational unit, or a plain container. */
export const DirectoryContainerSchema = z.looseObject({
    guid: z.string(),
    dn: z.string(),
    /** Null for the domain, which is the root of the tree. */
    parentDn: z.string().nullable(),
    name: z.string(),
    type: z.enum(DIRECTORY_CONTAINER_TYPES).catch("container"),
    description: z.string().nullish(),
    protected: z.boolean().default(false),
});

export type DirectoryRef = z.infer<typeof DirectoryRefSchema>;
export type DirectoryUser = z.infer<typeof DirectoryUserSchema>;
export type DirectoryGroup = z.infer<typeof DirectoryGroupSchema>;
export type DirectoryComputer = z.infer<typeof DirectoryComputerSchema>;
export type DirectoryContainer = z.infer<typeof DirectoryContainerSchema>;

// ── What a caller may send ───────────────────────────────────────────────────

/**
 * A `sAMAccountName`: what Windows accepts for a logon name. No surrounding spaces, none of
 * the characters it reserves, and not ending in a dot.
 */
const accountName = (max: number) =>
    z
        .string()
        .trim()
        .min(1, "A name is required")
        .max(max, `At most ${max} characters`)
        .regex(/^[^"/\\[\]:;|=,+*?<>@\s][^"/\\[\]:;|=,+*?<>@]*$/, 'May not contain " / \\ [ ] : ; | = , + * ? < > @')
        .refine((name) => !name.endsWith("."), { error: "May not end with a dot" });

/** A name as the first RDN of an object: anything, within reason. The agent escapes it. */
const ObjectNameSchema = z
    .string()
    .trim()
    .min(1, "A name is required")
    .max(64, "At most 64 characters")
    .refine((name) => !/[\0\n\r]/.test(name), { error: "May not contain line breaks" })
    .refine((name) => !name.endsWith("\\"), { error: "May not end with a backslash" });

/** A text attribute. `null` or the empty string clears it; an absent key leaves it alone. */
const text = (max: number) =>
    z
        .string()
        .trim()
        .max(max, `At most ${max} characters`)
        .nullable()
        .transform((value) => (value === "" ? null : value));

/**
 * A new password. Only that it is there is checked here: whether it is long and complex
 * enough is the domain's password policy to decide, and its refusal is passed on.
 */
const PasswordSchema = z.string().min(1, "A password is required").max(256);

export const CreateDirectoryUserSchema = z.object({
    /** The organizational unit or container the user is created in. */
    parentDn: DnSchema,
    accountName: accountName(20),
    givenName: text(64).optional(),
    surname: text(64).optional(),
    /** Defaults to the given name and surname, or else the account name. */
    displayName: text(256).optional(),
    /** Defaults to `<accountName>@<domain>`. */
    userPrincipalName: text(256).optional(),
    mail: text(256).optional(),
    description: text(1024).optional(),
    password: PasswordSchema,
    mustChangePassword: z.boolean().default(false),
    passwordNeverExpires: z.boolean().default(false),
    enabled: z.boolean().default(true),
});

export const UpdateDirectoryUserSchema = z
    .object({
        givenName: text(64).optional(),
        surname: text(64).optional(),
        displayName: text(256).optional(),
        userPrincipalName: text(256).optional(),
        mail: text(256).optional(),
        description: text(1024).optional(),
        passwordNeverExpires: z.boolean().optional(),
        /** An ISO date, or null for never. */
        accountExpires: z.iso.datetime().nullable().optional(),
    })
    .refine((changes) => Object.values(changes).some((value) => value !== undefined), { error: "Nothing to change" });

export const SetPasswordSchema = z.object({
    password: PasswordSchema,
    mustChangePassword: z.boolean().default(false),
});

export const SetEnabledSchema = z.object({ enabled: z.boolean() });

export const CreateGroupSchema = z.object({
    parentDn: DnSchema,
    name: accountName(64),
    description: text(1024).optional(),
    mail: text(256).optional(),
    scope: z.enum(GROUP_SCOPES).default("global"),
    kind: z.enum(GROUP_KINDS).default("security"),
});

export const UpdateGroupSchema = z
    .object({
        description: text(1024).optional(),
        mail: text(256).optional(),
    })
    .refine((changes) => Object.values(changes).some((value) => value !== undefined), { error: "Nothing to change" });

/** The objects to add to or remove from a group, by GUID. */
export const GroupMembersSchema = z.object({
    members: z.array(GuidSchema).min(1, "Name at least one member").max(500),
});

export const UpdateComputerSchema = z
    .object({ description: text(1024).optional() })
    .refine((changes) => Object.values(changes).some((value) => value !== undefined), { error: "Nothing to change" });

export const CreateOuSchema = z.object({
    parentDn: DnSchema,
    name: ObjectNameSchema,
    description: text(1024).optional(),
});

export const UpdateOuSchema = z
    .object({ description: text(1024).optional() })
    .refine((changes) => Object.values(changes).some((value) => value !== undefined), { error: "Nothing to change" });

/** Where an object goes: the DN of its new container. */
export const MoveObjectSchema = z.object({ parentDn: DnSchema });

/** An object's new name within its container. */
export const RenameObjectSchema = z.object({ name: ObjectNameSchema });

/** `GET /api/v1/directory/search`: what a picker looks for, and among which kinds. */
export const DirectorySearchSchema = z.object({
    query: z.string().trim().min(1).max(100),
    types: z.array(z.enum(["user", "group", "computer"])).min(1).default(["user", "group", "computer"]),
});

export type CreateDirectoryUser = z.input<typeof CreateDirectoryUserSchema>;
export type UpdateDirectoryUser = z.input<typeof UpdateDirectoryUserSchema>;
export type SetPassword = z.input<typeof SetPasswordSchema>;
export type CreateGroup = z.input<typeof CreateGroupSchema>;
export type UpdateGroup = z.input<typeof UpdateGroupSchema>;
export type UpdateComputer = z.input<typeof UpdateComputerSchema>;
export type CreateOu = z.input<typeof CreateOuSchema>;
export type UpdateOu = z.input<typeof UpdateOuSchema>;
