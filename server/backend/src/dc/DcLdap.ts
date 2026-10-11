import { Attribute, Change, Client, type Entry, type SearchOptions } from "ldapts";
import { logger } from "../core/logger.js";

/** How one domain controller's directory is reached, and as whom. */
export interface DcLdapOptions {
    /** `ldaps://host[:port]` */
    url: string;
    /**
     * The name the certificate is checked against, where the URL does not carry it: a domain
     * controller reached by an address an operator set still presents the certificate of
     * its own name.
     */
    servername?: string | null;
    /** The account to bind as. Without one the connection reads what the directory tells anyone. */
    bind?: { dn: string; password: string } | null;
    ca?: Buffer;
    allowSelfSigned: boolean;
    timeoutMs: number;
}

/**
 * A connection to the directory of one domain controller, over LDAPS.
 *
 * Kept open and bound once. Whoever needs the directory goes through `withClient`, which
 * opens it on demand and, when the connection turns out to be gone, opens a new one and
 * tries once more -- a domain controller that restarted must not cost a measurement more
 * than the one that noticed.
 *
 * An instance, not a singleton: this server talks to every domain controller of the domain,
 * and each has a connection of its own (see `DcConnections`).
 */
export class DcLdap {
    private client: Client | null = null;
    /** The connection attempt under way, shared by everyone who asks meanwhile. */
    private opening: Promise<Client> | null = null;

    constructor(private readonly options: DcLdapOptions) {}

    get url(): string {
        return this.options.url;
    }

    private async open(): Promise<Client> {
        const { url, servername, bind, ca, allowSelfSigned, timeoutMs } = this.options;
        const client = new Client({
            url,
            timeout: timeoutMs,
            connectTimeout: timeoutMs,
            tlsOptions: {
                ca,
                rejectUnauthorized: !allowSelfSigned,
                ...(servername ? { servername } : {}),
            },
        });
        try {
            if (bind) await client.bind(bind.dn, bind.password);
        } catch (err) {
            await client.unbind().catch(() => undefined);
            throw err;
        }
        return client;
    }

    private async connection(): Promise<Client> {
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
    async reset(): Promise<void> {
        const client = this.client;
        this.client = null;
        if (client) await client.unbind().catch(() => undefined);
    }

    /**
     * Runs `work` on the open connection. A failure that is the connection's -- not the
     * directory's answer to the request -- is retried once on a fresh one.
     */
    async withClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
        const first = await this.connection();
        try {
            return await work(first);
        } catch (err) {
            if (!isConnectionError(err)) throw err;
            logger.debug({ err, url: this.options.url }, "The directory connection was lost; opening a new one");
            await this.reset();
            return work(await this.connection());
        }
    }

    /** A search whose entries all arrive, however many pages that takes. */
    async search(base: string, options: SearchOptions): Promise<Entry[]> {
        return this.withClient(async (client) => {
            const { searchEntries } = await client.search(base, {
                paged: options.scope === "base" ? undefined : { pageSize: 500 },
                ...options,
            });
            return searchEntries;
        });
    }

    /** Creates an entry. A value may be bytes, which is what a password is written as. */
    add(dn: string, attributes: Record<string, string | string[] | Buffer>): Promise<void> {
        const list = Object.entries(attributes).map(([type, value]) =>
            Buffer.isBuffer(value)
                ? new Attribute({ type, values: [value] })
                : new Attribute({ type, values: Array.isArray(value) ? value : [value] }),
        );
        return this.withClient((client) => client.add(dn, list));
    }

    /** The first page of a search and no more: for a picker, which shows a handful of hits. */
    firstPage(base: string, options: SearchOptions, pageSize: number): Promise<Entry[]> {
        return this.withClient(async (client) => {
            for await (const page of client.searchPaginated(base, { ...options, paged: { pageSize } })) {
                return page.searchEntries;
            }
            return [];
        });
    }

    modify(dn: string, changes: Change[]): Promise<void> {
        return this.withClient((client) => client.modify(dn, changes));
    }

    /** Renames or moves: `newDn` is the new first RDN, optionally followed by the new parent. */
    modifyDn(dn: string, newDn: string): Promise<void> {
        return this.withClient((client) => client.modifyDN(dn, newDn));
    }

    del(dn: string): Promise<void> {
        return this.withClient((client) => client.del(dn));
    }

    /** The one entry at `dn`, or null when there is none. */
    async read(dn: string, attributes: string[], extra: Partial<SearchOptions> = {}): Promise<Entry | null> {
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

/** An attribute's bytes, for one that was asked for as binary (`explicitBufferAttributes`). */
export function attrBytes(entry: Entry | null | undefined, name: string): Uint8Array | null {
    const value = entry?.[name];
    const first = Array.isArray(value) ? value[0] : value;
    return Buffer.isBuffer(first) ? new Uint8Array(first) : null;
}

/** Every value of a binary attribute, for one that has several: a `repsFrom` per partner. */
export function attrBytesAll(entry: Entry | null | undefined, name: string): Uint8Array[] {
    const value = entry?.[name];
    if (value === undefined || value === null) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.filter((item): item is Buffer => Buffer.isBuffer(item)).map((item) => new Uint8Array(item));
}

/** Sets an attribute to `values`, or removes it for none. */
export const replace = (type: string, values: string[] | Buffer[]): Change =>
    new Change({ operation: "replace", modification: new Attribute({ type, values }) });

export const addValues = (type: string, values: string[]): Change =>
    new Change({ operation: "add", modification: new Attribute({ type, values }) });

export const deleteValues = (type: string, values: string[]): Change =>
    new Change({ operation: "delete", modification: new Attribute({ type, values }) });
