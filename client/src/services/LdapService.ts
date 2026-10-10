import { Attribute, Change, Client, type Entry, type SearchOptions } from "ldapts";
import { logger } from "@sadm/shared/node";
import { LDAP_PASSWORD, config, readLdapCa } from "../core/Config.js";

/**
 * The agent's connection to the directory of its own domain controller, over LDAPS.
 *
 * One connection, kept open and bound once. Whoever needs the directory goes through
 * `withClient`, which opens it on demand and, when the connection turns out to be gone,
 * opens a new one and tries once more -- a domain controller that restarted must not cost a
 * measurement more than the one that noticed.
 */
export class LdapService {
    private static client: Client | null = null;
    /** The connection attempt under way, shared by everyone who asks meanwhile. */
    private static opening: Promise<Client> | null = null;

    /** Whether the agent has been told where its directory is. */
    static isConfigured(): boolean {
        return !!config.ldap.url;
    }

    /** Whether it can bind, and so read more than the rootDSE and change anything at all. */
    static canBind(): boolean {
        return this.isConfigured() && !!config.ldap.bindDn && !!LDAP_PASSWORD;
    }

    /**
     * The domain controller's address, for probing its other services -- or null where the
     * URL does not give it. A URL with a port of its own is a mapping (a published container
     * port, a tunnel): what answers there on 88 or 445 is some other machine's business.
     */
    static dcHost(): string | null {
        if (!config.ldap.url) return null;
        try {
            const url = new URL(config.ldap.url);
            return url.port === "" || url.port === "636" ? url.hostname : null;
        } catch {
            return null;
        }
    }

    private static async open(): Promise<Client> {
        if (!config.ldap.url) throw new Error("No directory is configured (ldap.url)");
        const client = new Client({
            url: config.ldap.url,
            timeout: config.ldap.timeoutMs,
            connectTimeout: config.ldap.timeoutMs,
            tlsOptions: {
                ca: readLdapCa(),
                rejectUnauthorized: !config.ldap.allowSelfSigned,
            },
        });
        try {
            if (config.ldap.bindDn && LDAP_PASSWORD) {
                await client.bind(config.ldap.bindDn, LDAP_PASSWORD);
            }
        } catch (err) {
            await client.unbind().catch(() => undefined);
            throw err;
        }
        return client;
    }

    private static async connection(): Promise<Client> {
        if (this.client?.isConnected) return this.client;
        this.opening ??= this.open()
            .then((client) => {
                this.client = client;
                return client;
            })
            .finally(() => {
                this.opening = null;
            });
        return this.opening;
    }

    /** Drops the connection, so the next call opens a new one. */
    static async reset(): Promise<void> {
        const client = this.client;
        this.client = null;
        if (client) await client.unbind().catch(() => undefined);
    }

    /**
     * Runs `work` on the open connection. A failure that is the connection's -- not the
     * directory's answer to the request -- is retried once on a fresh one.
     */
    static async withClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
        const first = await this.connection();
        try {
            return await work(first);
        } catch (err) {
            if (!isConnectionError(err)) throw err;
            logger.debug({ err }, "The directory connection was lost; opening a new one");
            await this.reset();
            return work(await this.connection());
        }
    }

    /** A search whose entries all arrive, however many pages that takes. */
    static async search(base: string, options: SearchOptions): Promise<Entry[]> {
        return this.withClient(async (client) => {
            const { searchEntries } = await client.search(base, {
                paged: options.scope === "base" ? undefined : { pageSize: 500 },
                ...options,
            });
            return searchEntries;
        });
    }

    /** Creates an entry. A value may be bytes, which is what a password is written as. */
    static add(dn: string, attributes: Record<string, string | string[] | Buffer>): Promise<void> {
        const list = Object.entries(attributes).map(([type, value]) =>
            Buffer.isBuffer(value)
                ? new Attribute({ type, values: [value] })
                : new Attribute({ type, values: Array.isArray(value) ? value : [value] }),
        );
        return this.withClient((client) => client.add(dn, list));
    }

    /** The first page of a search and no more: for a picker, which shows a handful of hits. */
    static firstPage(base: string, options: SearchOptions, pageSize: number): Promise<Entry[]> {
        return this.withClient(async (client) => {
            for await (const page of client.searchPaginated(base, { ...options, paged: { pageSize } })) {
                return page.searchEntries;
            }
            return [];
        });
    }

    static modify(dn: string, changes: Change[]): Promise<void> {
        return this.withClient((client) => client.modify(dn, changes));
    }

    /** Renames or moves: `newDn` is the new first RDN, optionally followed by the new parent. */
    static modifyDn(dn: string, newDn: string): Promise<void> {
        return this.withClient((client) => client.modifyDN(dn, newDn));
    }

    static del(dn: string): Promise<void> {
        return this.withClient((client) => client.del(dn));
    }

    /** The one entry at `dn`, or null when there is none. */
    static async read(dn: string, attributes: string[], extra: Partial<SearchOptions> = {}): Promise<Entry | null> {
        try {
            const entries = await this.search(dn, { scope: "base", attributes, ...extra });
            return entries[0] ?? null;
        } catch (err) {
            if (ldapCode(err) === 32) return null;
            throw err;
        }
    }
}

/** The LDAP result code of an error the directory answered with, or null for any other error. */
export function ldapCode(err: unknown): number | null {
    const code = (err as { code?: unknown } | null)?.code;
    return typeof code === "number" ? code : null;
}

/** Whether an error is about the connection rather than an answer from the directory. */
function isConnectionError(err: unknown): boolean {
    if (ldapCode(err) !== null) return false;
    const code = (err as { code?: unknown } | null)?.code;
    const message = err instanceof Error ? err.message : "";
    return (
        (typeof code === "string" && /^(ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED|ERR_SOCKET)/.test(code)) ||
        /socket|closed|connection|timeout/i.test(message)
    );
}

/** The first value of an attribute as text, or null. */
export function attr(entry: Entry | null | undefined, name: string): string | null {
    const value = entry?.[name];
    const first = Array.isArray(value) ? value[0] : value;
    if (first === undefined || first === null) return null;
    const text = Buffer.isBuffer(first) ? first.toString("utf8") : String(first);
    return text === "" ? null : text;
}

/** Every value of an attribute as text. */
export function attrs(entry: Entry | null | undefined, name: string): string[] {
    const value = entry?.[name];
    if (value === undefined || value === null) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.map((item) => (Buffer.isBuffer(item) ? item.toString("utf8") : String(item))).filter((item) => item !== "");
}

/** An attribute's bytes, for the two that are binary: `objectGUID` and `objectSid`. */
export function attrBytes(entry: Entry | null | undefined, name: string): Uint8Array | null {
    const value = entry?.[name];
    const first = Array.isArray(value) ? value[0] : value;
    return Buffer.isBuffer(first) ? new Uint8Array(first) : null;
}

/** Sets an attribute to `values`, or removes it for none. */
export const replace = (type: string, values: string[] | Buffer[]): Change =>
    new Change({ operation: "replace", modification: new Attribute({ type, values }) });

export const addValues = (type: string, values: string[]): Change =>
    new Change({ operation: "add", modification: new Attribute({ type, values }) });

export const deleteValues = (type: string, values: string[]): Change =>
    new Change({ operation: "delete", modification: new Attribute({ type, values }) });
