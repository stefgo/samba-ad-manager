import type { Entry } from "ldapts";
import {
    UAC,
    dnsNameOfDn,
    encodeUnicodePwd,
    escapeFilterValue,
    escapeRdnValue,
    fileTimeToIso,
    formatGroupType,
    generalizedTimeToIso,
    guidDn,
    guidFromBytes,
    hasUacFlag,
    isDnWithin,
    isoToFileTime,
    parentDn,
    parseGroupType,
    parseUac,
    rdnValue,
    ridOfSid,
    sidFromBytes,
    withUacFlag,
    type AgentActionPayload,
    type DirectoryComputer,
    type DirectoryContainer,
    type DirectoryGroup,
    type DirectoryObjectType,
    type DirectoryRef,
    type DirectoryUser,
} from "@sadm/shared";
import { config } from "../core/Config.js";
import { AgentActionError } from "../core/AgentActionError.js";
import { LdapService, addValues, attr, attrBytes, attrs, deleteValues, ldapCode, replace } from "./LdapService.js";

const BINARY = ["objectGUID", "objectSid"];

const COMMON = ["objectGUID", "objectClass", "cn", "description", "whenCreated", "whenChanged", "isCriticalSystemObject"];

const USER_ATTRIBUTES = [
    ...COMMON,
    "objectSid",
    "sAMAccountName",
    "userPrincipalName",
    "displayName",
    "givenName",
    "sn",
    "mail",
    "userAccountControl",
    "lockoutTime",
    "pwdLastSet",
    "lastLogonTimestamp",
    "accountExpires",
    "primaryGroupID",
];

const GROUP_ATTRIBUTES = [...COMMON, "objectSid", "sAMAccountName", "mail", "groupType", "member"];

const COMPUTER_ATTRIBUTES = [
    ...COMMON,
    "objectSid",
    "sAMAccountName",
    "dNSHostName",
    "operatingSystem",
    "operatingSystemVersion",
    "userAccountControl",
    "pwdLastSet",
    "lastLogonTimestamp",
    "primaryGroupID",
];

const REF_ATTRIBUTES = ["objectGUID", "objectClass", "cn", "sAMAccountName", "displayName", "description"];

const FILTER = {
    user: "(&(objectCategory=person)(objectClass=user))",
    group: "(objectCategory=group)",
    computer: "(objectCategory=computer)",
} as const;

/** How many DNs go into one filter when a list of them is resolved. */
const RESOLVE_CHUNK = 50;

const SEARCH_LIMIT = 50;

const notFound = (what: string) => new AgentActionError("not-found", `The ${what} does not exist (any more)`);

const guidOf = (entry: Entry): string => {
    const bytes = attrBytes(entry, "objectGUID");
    return (bytes && guidFromBytes(bytes)) ?? "";
};

const sidOf = (entry: Entry): string | null => {
    const bytes = attrBytes(entry, "objectSid");
    return bytes ? sidFromBytes(bytes) : null;
};

const isCritical = (entry: Entry): boolean => attr(entry, "isCriticalSystemObject")?.toUpperCase() === "TRUE";

function typeOf(entry: Entry): DirectoryObjectType {
    const classes = new Set(attrs(entry, "objectClass").map((name) => name.toLowerCase()));
    // A computer is a user as far as its classes go, so it is asked first.
    if (classes.has("computer")) return "computer";
    if (classes.has("user")) return "user";
    if (classes.has("group")) return "group";
    if (classes.has("organizationalunit")) return "ou";
    if (classes.has("container") || classes.has("builtindomain")) return "container";
    return "other";
}

function toRef(entry: Entry): DirectoryRef {
    const type = typeOf(entry);
    const account = attr(entry, "sAMAccountName");
    const cn = rdnValue(entry.dn) ?? attr(entry, "cn") ?? entry.dn;
    const named = type === "user" || type === "group" || type === "computer";
    return {
        guid: guidOf(entry),
        dn: entry.dn,
        name: (named && account) || cn,
        type,
        detail: (type === "user" ? attr(entry, "displayName") : null) ?? attr(entry, "description"),
    };
}

function base(entry: Entry) {
    return {
        guid: guidOf(entry),
        dn: entry.dn,
        parentDn: parentDn(entry.dn) ?? "",
        cn: rdnValue(entry.dn) ?? attr(entry, "cn") ?? "",
        description: attr(entry, "description"),
        whenCreated: generalizedTimeToIso(attr(entry, "whenCreated")),
        whenChanged: generalizedTimeToIso(attr(entry, "whenChanged")),
    };
}

function toUser(entry: Entry, protectedGuids: ReadonlySet<string>): DirectoryUser {
    const uac = parseUac(attr(entry, "userAccountControl"));
    const lockoutTime = attr(entry, "lockoutTime");
    return {
        ...base(entry),
        protected: isCritical(entry) || protectedGuids.has(guidOf(entry)),
        sid: sidOf(entry),
        accountName: attr(entry, "sAMAccountName") ?? "",
        userPrincipalName: attr(entry, "userPrincipalName"),
        displayName: attr(entry, "displayName"),
        givenName: attr(entry, "givenName"),
        surname: attr(entry, "sn"),
        mail: attr(entry, "mail"),
        enabled: !hasUacFlag(uac, UAC.ACCOUNT_DISABLE),
        lockedOut: !!lockoutTime && lockoutTime !== "0",
        passwordNeverExpires: hasUacFlag(uac, UAC.DONT_EXPIRE_PASSWORD),
        mustChangePassword: attr(entry, "pwdLastSet") === "0" && !hasUacFlag(uac, UAC.DONT_EXPIRE_PASSWORD),
        passwordLastSet: fileTimeToIso(attr(entry, "pwdLastSet")),
        lastLogon: fileTimeToIso(attr(entry, "lastLogonTimestamp")),
        accountExpires: fileTimeToIso(attr(entry, "accountExpires")),
    };
}

function toGroup(entry: Entry): DirectoryGroup {
    return {
        ...base(entry),
        protected: isCritical(entry),
        sid: sidOf(entry),
        accountName: attr(entry, "sAMAccountName") ?? "",
        mail: attr(entry, "mail"),
        ...parseGroupType(attr(entry, "groupType")),
        memberCount: attrs(entry, "member").length,
    };
}

function toComputer(entry: Entry): DirectoryComputer {
    const uac = parseUac(attr(entry, "userAccountControl"));
    const isDomainController = hasUacFlag(uac, UAC.SERVER_TRUST_ACCOUNT);
    return {
        ...base(entry),
        // A domain controller's account is the domain controller: removing it is a demotion.
        protected: isCritical(entry) || isDomainController,
        sid: sidOf(entry),
        accountName: attr(entry, "sAMAccountName") ?? "",
        dnsHostName: attr(entry, "dNSHostName"),
        operatingSystem: attr(entry, "operatingSystem"),
        operatingSystemVersion: attr(entry, "operatingSystemVersion"),
        enabled: !hasUacFlag(uac, UAC.ACCOUNT_DISABLE),
        isDomainController,
        passwordLastSet: fileTimeToIso(attr(entry, "pwdLastSet")),
        lastLogon: fileTimeToIso(attr(entry, "lastLogonTimestamp")),
    };
}

/** What a change was made to, for the server's record of it. */
interface Changed {
    name: string;
    dn: string;
    type: DirectoryObjectType;
}

function changed(entry: Entry): Changed {
    const { name, dn, type } = toRef(entry);
    return { name, dn, type };
}

const byName = <T extends { accountName?: string; name?: string }>(a: T, b: T) =>
    (a.accountName ?? a.name ?? "").localeCompare(b.accountName ?? b.name ?? "");

/**
 * Turns what the directory refused with into what the server is told. The directory's own
 * words go along where it has any: "the password does not meet the policy" is the answer,
 * and no paraphrase of it would say more.
 */
function directoryError(err: unknown, what: string): AgentActionError {
    if (err instanceof AgentActionError) return err;
    const code = ldapCode(err);
    const detail = err instanceof Error ? err.message.replace(/\s+/g, " ").trim() : String(err);
    switch (code) {
        case 32:
            return notFound(what);
        case 68:
            return new AgentActionError("conflict", `Something of that name exists already (${detail})`);
        case 50:
            return new AgentActionError("forbidden", `The directory denies this to the agent's account (${detail})`);
        case 66:
            return new AgentActionError("conflict", `It is not empty: move or delete what is in it first`);
        case 19:
        case 53:
            return new AgentActionError("invalid", `The directory refuses: ${detail}`);
        case null:
            return new AgentActionError("failed", `The directory could not be reached: ${detail}`);
        default:
            return new AgentActionError("failed", `The directory refused (LDAP ${code}): ${detail}`);
    }
}

/**
 * The directory objects of this agent's domain controller: users, groups, computers and the
 * containers they live in -- read and, unless the agent is read-only, changed.
 *
 * Everything goes over LDAPS, as the account in `ldap.bindDn`. An object is addressed by its
 * GUID, and every change first reads what it is about to change: that is where a protected
 * object is refused and where a GUID that names something else than the request thinks is
 * noticed. The server checks the same things; here is where it counts, because this side
 * is the one an attacker who took the server over still has to get past.
 */
export class DirectoryService {
    private static domain: { dn: string; dnsName: string } | null = null;
    /** The agent's own account: not deleted, disabled or locked out of the directory from here. */
    private static ownGuid: string | null | undefined;

    /** Whether the server may ask this agent about objects at all. */
    static isEnabled(): boolean {
        return config.directory.enabled && LdapService.canBind();
    }

    static isWritable(): boolean {
        return this.isEnabled() && !config.directory.readOnly;
    }

    private static assertEnabled(): void {
        if (!config.directory.enabled) {
            throw new AgentActionError("forbidden", "This agent does not serve the directory (directory.enabled is false)");
        }
        if (!LdapService.canBind()) {
            throw new AgentActionError("forbidden", "This agent has no account in the directory (ldap.bindDn and its password)");
        }
    }

    private static assertWritable(): void {
        this.assertEnabled();
        if (config.directory.readOnly) {
            throw new AgentActionError("forbidden", "This agent is read-only (directory.readOnly is true)");
        }
    }

    private static async domainInfo(): Promise<{ dn: string; dnsName: string }> {
        if (this.domain) return this.domain;
        const root = await LdapService.read("", ["defaultNamingContext"]);
        const dn = attr(root, "defaultNamingContext");
        if (!dn) throw new AgentActionError("failed", "The directory does not name its domain");
        this.domain = { dn, dnsName: dnsNameOfDn(dn) ?? dn };
        return this.domain;
    }

    private static async protectedGuids(): Promise<ReadonlySet<string>> {
        if (this.ownGuid === undefined) {
            const bind = config.ldap.bindDn ?? "";
            const { dn } = await this.domainInfo();
            const filter = bind.includes("=")
                ? `(distinguishedName=${escapeFilterValue(bind)})`
                : `(|(userPrincipalName=${escapeFilterValue(bind)})(sAMAccountName=${escapeFilterValue(bind.split("@")[0])}))`;
            const [own] = await LdapService.search(dn, {
                scope: "sub",
                filter,
                attributes: ["objectGUID"],
                explicitBufferAttributes: BINARY,
            });
            this.ownGuid = own ? guidOf(own) : null;
        }
        return new Set(this.ownGuid ? [this.ownGuid] : []);
    }

    /** The entry a GUID names, with the attributes asked for; a `not-found` refusal when there is none. */
    private static async entryByGuid(guid: string, attributes: string[], what: string): Promise<Entry> {
        let entry: Entry | null;
        try {
            // Always with what names the object: every change answers with what it was made to.
            entry = await LdapService.read(guidDn(guid), [...new Set([...attributes, ...REF_ATTRIBUTES])], {
                explicitBufferAttributes: BINARY,
            });
        } catch (err) {
            throw directoryError(err, what);
        }
        if (!entry) throw notFound(what);
        return entry;
    }

    private static async typedEntry(guid: string, type: DirectoryObjectType, attributes: string[]): Promise<Entry> {
        const entry = await this.entryByGuid(guid, attributes, type);
        if (typeOf(entry) !== type) throw notFound(type);
        return entry;
    }

    /** The refs of a list of DNs, in a few searches rather than one per DN. */
    private static async resolveDns(dns: string[]): Promise<DirectoryRef[]> {
        const { dn: domainDn } = await this.domainInfo();
        const refs: DirectoryRef[] = [];
        for (let i = 0; i < dns.length; i += RESOLVE_CHUNK) {
            const chunk = dns.slice(i, i + RESOLVE_CHUNK);
            const filter = `(|${chunk.map((dn) => `(distinguishedName=${escapeFilterValue(dn)})`).join("")})`;
            const entries = await LdapService.search(domainDn, {
                scope: "sub",
                filter,
                attributes: REF_ATTRIBUTES,
                explicitBufferAttributes: BINARY,
            });
            refs.push(...entries.map(toRef));
        }
        return refs.sort((a, b) => a.name.localeCompare(b.name));
    }

    /** The groups an account is a direct member of, the primary one first. */
    private static async groupsOf(entry: Entry): Promise<DirectoryRef[]> {
        const { dn: domainDn } = await this.domainInfo();
        const full = await LdapService.read(entry.dn, ["memberOf"]);
        const groups = await this.resolveDns(attrs(full, "memberOf"));
        const sid = sidOf(entry);
        const primaryRid = attr(entry, "primaryGroupID");
        if (sid && primaryRid) {
            // The primary group is not in `memberOf`; it is named by its RID within the domain.
            const primarySid = sid.replace(/-\d+$/, `-${primaryRid}`);
            const [primary] = await LdapService.search(domainDn, {
                scope: "sub",
                filter: `(objectSid=${escapeFilterValue(primarySid)})`,
                attributes: REF_ATTRIBUTES,
                explicitBufferAttributes: BINARY,
            });
            if (primary) groups.unshift({ ...toRef(primary), detail: "Primary group" });
        }
        return groups;
    }

    // ── Reading ──────────────────────────────────────────────────────────────

    static async listUsers(): Promise<{ users: DirectoryUser[] }> {
        this.assertEnabled();
        try {
            const { dn } = await this.domainInfo();
            const own = await this.protectedGuids();
            const entries = await LdapService.search(dn, {
                scope: "sub",
                filter: FILTER.user,
                attributes: USER_ATTRIBUTES,
                explicitBufferAttributes: BINARY,
            });
            return { users: entries.map((entry) => toUser(entry, own)).sort(byName) };
        } catch (err) {
            throw directoryError(err, "user");
        }
    }

    static async getUser({ guid }: { guid: string }): Promise<DirectoryUser> {
        this.assertEnabled();
        const entry = await this.typedEntry(guid, "user", USER_ATTRIBUTES);
        try {
            return { ...toUser(entry, await this.protectedGuids()), memberOf: await this.groupsOf(entry) };
        } catch (err) {
            throw directoryError(err, "user");
        }
    }

    static async listGroups(): Promise<{ groups: DirectoryGroup[] }> {
        this.assertEnabled();
        try {
            const { dn } = await this.domainInfo();
            const entries = await LdapService.search(dn, {
                scope: "sub",
                filter: FILTER.group,
                attributes: GROUP_ATTRIBUTES,
                explicitBufferAttributes: BINARY,
            });
            return { groups: entries.map(toGroup).sort(byName) };
        } catch (err) {
            throw directoryError(err, "group");
        }
    }

    static async getGroup({ guid }: { guid: string }): Promise<DirectoryGroup> {
        this.assertEnabled();
        const entry = await this.typedEntry(guid, "group", GROUP_ATTRIBUTES);
        try {
            const { dn: domainDn } = await this.domainInfo();
            const rid = ridOfSid(sidOf(entry));
            // Direct members, and the accounts that have the group as their primary one --
            // which is how every user is in Domain Users without being listed in it.
            const filter = `(|(memberOf=${escapeFilterValue(entry.dn)})${rid !== null ? `(primaryGroupID=${rid})` : ""})`;
            const members = await LdapService.search(domainDn, {
                scope: "sub",
                filter,
                attributes: REF_ATTRIBUTES,
                explicitBufferAttributes: BINARY,
            });
            const full = await LdapService.read(entry.dn, ["memberOf"]);
            return {
                ...toGroup(entry),
                members: members.map(toRef).sort((a, b) => a.name.localeCompare(b.name)),
                memberOf: await this.resolveDns(attrs(full, "memberOf")),
            };
        } catch (err) {
            throw directoryError(err, "group");
        }
    }

    static async listComputers(): Promise<{ computers: DirectoryComputer[] }> {
        this.assertEnabled();
        try {
            const { dn } = await this.domainInfo();
            const entries = await LdapService.search(dn, {
                scope: "sub",
                filter: FILTER.computer,
                attributes: COMPUTER_ATTRIBUTES,
                explicitBufferAttributes: BINARY,
            });
            return { computers: entries.map(toComputer).sort(byName) };
        } catch (err) {
            throw directoryError(err, "computer");
        }
    }

    static async getComputer({ guid }: { guid: string }): Promise<DirectoryComputer> {
        this.assertEnabled();
        const entry = await this.typedEntry(guid, "computer", COMPUTER_ATTRIBUTES);
        try {
            return { ...toComputer(entry), memberOf: await this.groupsOf(entry) };
        } catch (err) {
            throw directoryError(err, "computer");
        }
    }

    /**
     * The places objects live in: the domain, every organizational unit, and the containers
     * directly below the domain that the directory does not hide (`showInAdvancedViewOnly`)
     * -- Users, Computers, Builtin and the like, without the system's own.
     */
    static async tree(): Promise<{ baseDn: string; containers: DirectoryContainer[] }> {
        this.assertEnabled();
        try {
            const { dn: domainDn, dnsName } = await this.domainInfo();
            const attributes = ["objectGUID", "objectClass", "description", "isCriticalSystemObject", "ou", "cn"];
            const [root, units, top] = await Promise.all([
                LdapService.read(domainDn, attributes, { explicitBufferAttributes: BINARY }),
                LdapService.search(domainDn, {
                    scope: "sub",
                    filter: "(objectClass=organizationalUnit)",
                    attributes,
                    explicitBufferAttributes: BINARY,
                }),
                LdapService.search(domainDn, {
                    scope: "one",
                    filter: "(&(|(objectClass=container)(objectClass=builtinDomain))(!(showInAdvancedViewOnly=TRUE)))",
                    attributes,
                    explicitBufferAttributes: BINARY,
                }),
            ]);
            const node = (entry: Entry): DirectoryContainer => {
                const classes = attrs(entry, "objectClass").map((name) => name.toLowerCase());
                return {
                    guid: guidOf(entry),
                    dn: entry.dn,
                    parentDn: parentDn(entry.dn),
                    name: rdnValue(entry.dn) ?? entry.dn,
                    type: classes.includes("organizationalunit") ? "ou" : classes.includes("builtindomain") ? "builtin" : "container",
                    description: attr(entry, "description"),
                    // The containers the domain is provisioned with are part of it. So is the
                    // OU its domain controllers live in.
                    protected: isCritical(entry) || !classes.includes("organizationalunit"),
                };
            };
            const containers: DirectoryContainer[] = [
                ...(root ? [{ ...node(root), parentDn: null, name: dnsName, type: "domain" as const, protected: true }] : []),
                ...[...units, ...top].map(node).sort((a, b) => a.name.localeCompare(b.name)),
            ];
            return { baseDn: domainDn, containers };
        } catch (err) {
            throw directoryError(err, "directory");
        }
    }

    static async children({ dn }: { dn: string }): Promise<{ objects: DirectoryRef[] }> {
        this.assertEnabled();
        try {
            const { dn: domainDn } = await this.domainInfo();
            if (!isDnWithin(dn, domainDn)) throw new AgentActionError("invalid", "That is not a place in this domain");
            const entries = await LdapService.search(dn, {
                scope: "one",
                filter: "(!(showInAdvancedViewOnly=TRUE))",
                attributes: REF_ATTRIBUTES,
                explicitBufferAttributes: BINARY,
            });
            return { objects: entries.map(toRef).sort((a, b) => a.name.localeCompare(b.name)) };
        } catch (err) {
            throw directoryError(err, "container");
        }
    }

    static async search({ query, types }: { query: string; types: ("user" | "group" | "computer")[] }): Promise<{
        objects: DirectoryRef[];
    }> {
        this.assertEnabled();
        try {
            const { dn } = await this.domainInfo();
            const q = escapeFilterValue(query);
            const kinds = `(|${types.map((type) => FILTER[type]).join("")})`;
            const name = `(|(sAMAccountName=${q}*)(cn=${q}*)(displayName=${q}*)(sn=${q}*)(mail=${q}*))`;
            const entries = await LdapService.firstPage(
                dn,
                { scope: "sub", filter: `(&${kinds}${name})`, attributes: REF_ATTRIBUTES, explicitBufferAttributes: BINARY },
                SEARCH_LIMIT,
            );
            return { objects: entries.map(toRef).sort((a, b) => a.name.localeCompare(b.name)) };
        } catch (err) {
            throw directoryError(err, "search");
        }
    }

    // ── Changing ─────────────────────────────────────────────────────────────

    /** A container objects may be put into: in this domain, and there. */
    private static async assertParent(dn: string): Promise<void> {
        const { dn: domainDn } = await this.domainInfo();
        if (!isDnWithin(dn, domainDn)) throw new AgentActionError("invalid", "The target is not a place in this domain");
        const parent = await LdapService.read(dn, ["objectClass"]).catch((err) => {
            throw directoryError(err, "target container");
        });
        if (!parent) throw notFound("target container");
    }

    private static assertNotProtected(entry: Entry, own: ReadonlySet<string>, verb: string): void {
        const uac = parseUac(attr(entry, "userAccountControl"));
        if (isCritical(entry)) {
            throw new AgentActionError("forbidden", `The directory needs this object; it cannot be ${verb} from here`);
        }
        if (hasUacFlag(uac, UAC.SERVER_TRUST_ACCOUNT)) {
            throw new AgentActionError("forbidden", `This is a domain controller's own account; it cannot be ${verb} from here`);
        }
        if (own.has(guidOf(entry))) {
            throw new AgentActionError("forbidden", `This is the account the agent itself uses; it cannot be ${verb} from here`);
        }
    }

    /** What was just created at `dn`, read back: its GUID is the directory's to give. */
    private static async createdAt(dn: string): Promise<Changed & { guid: string }> {
        const entry = await LdapService.read(dn, REF_ATTRIBUTES, { explicitBufferAttributes: BINARY });
        if (!entry) throw new AgentActionError("failed", "The object was created, but could not be read back");
        return { ...changed(entry), guid: guidOf(entry) };
    }

    /** One `replace` per attribute that is named: a value sets it, `null` removes it. */
    private static textChanges(changes: Record<string, unknown>, names: Record<string, string>) {
        return Object.entries(names).flatMap(([key, attribute]) => {
            const value = changes[key];
            if (value === null) return [replace(attribute, [])];
            return typeof value === "string" ? [replace(attribute, [value])] : [];
        });
    }

    static async createUser(input: AgentActionPayload<"directory.user.create">): Promise<Changed & { guid: string }> {
        this.assertWritable();
        try {
            await this.assertParent(input.parentDn);
            const { dnsName } = await this.domainInfo();
            const full = [input.givenName, input.surname].filter(Boolean).join(" ");
            const displayName = input.displayName ?? (full || null);
            const cn = displayName ?? input.accountName;
            const dn = `CN=${escapeRdnValue(cn)},${input.parentDn}`;

            let uac: number = UAC.NORMAL_ACCOUNT;
            uac = withUacFlag(uac, UAC.ACCOUNT_DISABLE, input.enabled === false);
            uac = withUacFlag(uac, UAC.DONT_EXPIRE_PASSWORD, input.passwordNeverExpires === true);

            const attributes: Record<string, string | string[] | Buffer> = {
                objectClass: ["top", "person", "organizationalPerson", "user"],
                sAMAccountName: input.accountName,
                userPrincipalName: input.userPrincipalName ?? `${input.accountName}@${dnsName}`,
                unicodePwd: Buffer.from(encodeUnicodePwd(input.password)),
                userAccountControl: String(uac),
            };
            const optional: Record<string, string | null | undefined> = {
                givenName: input.givenName,
                sn: input.surname,
                displayName,
                mail: input.mail,
                description: input.description,
            };
            for (const [name, value] of Object.entries(optional)) if (value) attributes[name] = value;
            if (input.mustChangePassword) attributes.pwdLastSet = "0";

            await LdapService.add(dn, attributes);
            return this.createdAt(dn);
        } catch (err) {
            throw directoryError(err, "user");
        }
    }

    static async updateUser({ guid, changes }: AgentActionPayload<"directory.user.update">): Promise<Changed> {
        this.assertWritable();
        const entry = await this.typedEntry(guid, "user", ["objectGUID", "objectClass", "userAccountControl"]);
        try {
            const modifications = this.textChanges(changes, {
                givenName: "givenName",
                surname: "sn",
                displayName: "displayName",
                userPrincipalName: "userPrincipalName",
                mail: "mail",
                description: "description",
            });
            if (changes.passwordNeverExpires !== undefined) {
                const uac = parseUac(attr(entry, "userAccountControl"));
                modifications.push(
                    replace("userAccountControl", [String(withUacFlag(uac, UAC.DONT_EXPIRE_PASSWORD, changes.passwordNeverExpires))]),
                );
            }
            if (changes.accountExpires !== undefined) {
                modifications.push(replace("accountExpires", [isoToFileTime(changes.accountExpires)]));
            }
            if (modifications.length > 0) await LdapService.modify(entry.dn, modifications);
            return changed(entry);
        } catch (err) {
            throw directoryError(err, "user");
        }
    }

    static async setPassword({
        guid,
        password,
        mustChangePassword,
    }: AgentActionPayload<"directory.user.setPassword">): Promise<Changed> {
        this.assertWritable();
        const entry = await this.typedEntry(guid, "user", ["objectGUID", "objectClass"]);
        try {
            await LdapService.modify(entry.dn, [replace("unicodePwd", [Buffer.from(encodeUnicodePwd(password))])]);
            // 0: has to be changed at the next logon. -1: set just now.
            await LdapService.modify(entry.dn, [replace("pwdLastSet", [mustChangePassword ? "0" : "-1"])]);
            return changed(entry);
        } catch (err) {
            throw directoryError(err, "user");
        }
    }

    static async unlockUser({ guid }: { guid: string }): Promise<Changed> {
        this.assertWritable();
        const entry = await this.typedEntry(guid, "user", ["objectGUID", "objectClass"]);
        try {
            await LdapService.modify(entry.dn, [replace("lockoutTime", ["0"])]);
            return changed(entry);
        } catch (err) {
            throw directoryError(err, "user");
        }
    }

    static async setEnabled({ guid, enabled }: AgentActionPayload<"directory.account.setEnabled">): Promise<Changed> {
        this.assertWritable();
        const entry = await this.entryByGuid(
            guid,
            ["objectGUID", "objectClass", "userAccountControl", "isCriticalSystemObject"],
            "account",
        );
        const type = typeOf(entry);
        if (type !== "user" && type !== "computer") throw notFound("account");
        try {
            // Switching an account on is never what breaks a domain; switching the wrong one off is.
            if (!enabled) this.assertNotProtected(entry, await this.protectedGuids(), "disabled");
            const uac = parseUac(attr(entry, "userAccountControl"));
            await LdapService.modify(entry.dn, [
                replace("userAccountControl", [String(withUacFlag(uac, UAC.ACCOUNT_DISABLE, !enabled))]),
            ]);
            return changed(entry);
        } catch (err) {
            throw directoryError(err, "account");
        }
    }

    static async createGroup(input: AgentActionPayload<"directory.group.create">): Promise<Changed & { guid: string }> {
        this.assertWritable();
        try {
            await this.assertParent(input.parentDn);
            const dn = `CN=${escapeRdnValue(input.name)},${input.parentDn}`;
            const attributes: Record<string, string | string[]> = {
                objectClass: ["top", "group"],
                sAMAccountName: input.name,
                groupType: formatGroupType(input.scope ?? "global", input.kind ?? "security"),
            };
            if (input.description) attributes.description = input.description;
            if (input.mail) attributes.mail = input.mail;
            await LdapService.add(dn, attributes);
            return this.createdAt(dn);
        } catch (err) {
            throw directoryError(err, "group");
        }
    }

    static async updateGroup({ guid, changes }: AgentActionPayload<"directory.group.update">): Promise<Changed> {
        this.assertWritable();
        const entry = await this.typedEntry(guid, "group", ["objectGUID", "objectClass"]);
        try {
            const modifications = this.textChanges(changes, { description: "description", mail: "mail" });
            if (modifications.length > 0) await LdapService.modify(entry.dn, modifications);
            return changed(entry);
        } catch (err) {
            throw directoryError(err, "group");
        }
    }

    /**
     * Adds to or removes from a group, one member at a time: a member that is one already --
     * or is none -- is not a failure of the others, and a single modification with all of
     * them would be refused as a whole.
     */
    private static async changeMembers(guid: string, members: string[], add: boolean): Promise<Changed> {
        this.assertWritable();
        const group = await this.typedEntry(guid, "group", ["objectGUID", "objectClass"]);
        try {
            for (const member of members) {
                const entry = await this.entryByGuid(member, ["objectGUID", "objectClass"], "member");
                try {
                    await LdapService.modify(group.dn, [add ? addValues("member", [entry.dn]) : deleteValues("member", [entry.dn])]);
                } catch (err) {
                    const code = ldapCode(err);
                    // 68: a member already. 16 / 53: not a member -- or one by its primary group,
                    // which is not a membership this attribute holds.
                    if (add && code === 68) continue;
                    if (!add && code === 16) continue;
                    if (!add && code === 53) {
                        throw new AgentActionError(
                            "invalid",
                            `${rdnValue(entry.dn) ?? "A member"} cannot be removed: this is its primary group, or it is no member`,
                        );
                    }
                    throw err;
                }
            }
            return changed(group);
        } catch (err) {
            throw directoryError(err, "group");
        }
    }

    static addMembers({ guid, members }: AgentActionPayload<"directory.group.addMembers">) {
        return this.changeMembers(guid, members, true);
    }

    static removeMembers({ guid, members }: AgentActionPayload<"directory.group.removeMembers">) {
        return this.changeMembers(guid, members, false);
    }

    static async updateComputer({ guid, changes }: AgentActionPayload<"directory.computer.update">): Promise<Changed> {
        this.assertWritable();
        const entry = await this.typedEntry(guid, "computer", ["objectGUID", "objectClass"]);
        try {
            const modifications = this.textChanges(changes, { description: "description" });
            if (modifications.length > 0) await LdapService.modify(entry.dn, modifications);
            return changed(entry);
        } catch (err) {
            throw directoryError(err, "computer");
        }
    }

    static async createOu(input: AgentActionPayload<"directory.ou.create">): Promise<Changed & { guid: string }> {
        this.assertWritable();
        try {
            await this.assertParent(input.parentDn);
            const dn = `OU=${escapeRdnValue(input.name)},${input.parentDn}`;
            const attributes: Record<string, string | string[]> = { objectClass: ["top", "organizationalUnit"] };
            if (input.description) attributes.description = input.description;
            await LdapService.add(dn, attributes);
            return this.createdAt(dn);
        } catch (err) {
            throw directoryError(err, "organizational unit");
        }
    }

    static async updateOu({ guid, changes }: AgentActionPayload<"directory.ou.update">): Promise<Changed> {
        this.assertWritable();
        const entry = await this.typedEntry(guid, "ou", ["objectGUID", "objectClass"]);
        try {
            const modifications = this.textChanges(changes, { description: "description" });
            if (modifications.length > 0) await LdapService.modify(entry.dn, modifications);
            return changed(entry);
        } catch (err) {
            throw directoryError(err, "organizational unit");
        }
    }

    /** The entry of something that may be moved, renamed or deleted: of a kind this application manages, and not protected. */
    private static async changeable(guid: string, verb: string): Promise<Entry> {
        const entry = await this.entryByGuid(
            guid,
            ["objectGUID", "objectClass", "userAccountControl", "isCriticalSystemObject"],
            "object",
        );
        const type = typeOf(entry);
        if (type === "other" || type === "container") {
            throw new AgentActionError("forbidden", `Objects of this kind cannot be ${verb} from here`);
        }
        this.assertNotProtected(entry, await this.protectedGuids(), verb);
        return entry;
    }

    /** The first RDN as the directory wrote it: `CN=Doe\, Jane`. */
    private static firstRdn(dn: string): string {
        const end = dn.search(/[^\\],/);
        return end === -1 ? dn : dn.slice(0, end + 1);
    }

    static async moveObject({ guid, parentDn: target }: AgentActionPayload<"directory.object.move">): Promise<Changed> {
        this.assertWritable();
        const entry = await this.changeable(guid, "moved");
        try {
            await this.assertParent(target);
            if (isDnWithin(target, entry.dn)) {
                throw new AgentActionError("invalid", "An organizational unit cannot be moved into itself");
            }
            await LdapService.modifyDn(entry.dn, `${this.firstRdn(entry.dn)},${target}`);
            return changed(entry);
        } catch (err) {
            throw directoryError(err, "object");
        }
    }

    static async renameObject({ guid, name }: AgentActionPayload<"directory.object.rename">): Promise<Changed> {
        this.assertWritable();
        const entry = await this.changeable(guid, "renamed");
        try {
            const type = this.firstRdn(entry.dn).split("=")[0];
            await LdapService.modifyDn(entry.dn, `${type}=${escapeRdnValue(name)}`);
            return changed(entry);
        } catch (err) {
            throw directoryError(err, "object");
        }
    }

    static async deleteObject({ guid }: { guid: string }): Promise<Changed> {
        this.assertWritable();
        const entry = await this.changeable(guid, "deleted");
        try {
            await LdapService.del(entry.dn);
            return changed(entry);
        } catch (err) {
            throw directoryError(err, "object");
        }
    }
}
