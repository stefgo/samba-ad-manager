import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as client from "openid-client";
import YAML from "yaml";
import { logger } from "../core/logger.js";
import {
    AppConfigSchema,
    AppSettingsSchema,
    DEFAULT_SERVER_PORT,
    DirectoryConfigSchema,
    firstIssue,
    HealthConfigSchema,
    LdapServiceUrlSchema,
    LdapsUrlSchema,
    OidcConfigSchema,
    SecurityConfigSchema,
    TrustedProxySchema,
    type AppConfigParsed,
} from "@sadm/shared";

import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "../../../config.yaml");

/**
 * The shape of config.yaml, derived from the schema in `shared` rather than declared a second
 * time. The top level and `settings` stay loose (see AppConfigSchema): unknown keys are an
 * operator's own additions, and saveConfig() writes this object back into the file.
 */
export type AppConfig = AppConfigParsed;

let configDoc: YAML.Document = new YAML.Document({});
let config: Record<string, unknown> = {};
let newDefaultsAdded = false;

/**
 * Reads config.yaml as it stands, without filling anything in: defaults belong to
 * AppConfigSchema, and that cannot run yet -- jwtSecret is generated below on first start,
 * and validating before that would reject every fresh installation.
 */
function loadConfig() {
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const fileContent = fs.readFileSync(CONFIG_PATH, "utf-8");
            configDoc = YAML.parseDocument(fileContent);
            const loaded = configDoc.toJS();
            config = loaded && typeof loaded === "object" ? loaded : {};
        } catch (e) {
            logger.error({ err: e }, "Failed to load config.yaml");
        }
    }

    const settings = config.settings;
    if (settings && typeof settings === "object") {
        const present = settings as Record<string, unknown>;
        // Written back only when a default was missing, as before: a rewrite for no reason
        // would requote values and reflow the operator's file.
        const defaults = AppSettingsSchema.parse({});
        newDefaultsAdded = Object.keys(defaults).some((key) => !(key in present));
    } else {
        newDefaultsAdded = true;
    }
}

/**
 * Synchronizes the YAML document with the current config object
 * while preserving structure and comments.
 */
function syncDoc() {
    if (!configDoc.contents) {
        configDoc.contents = configDoc.createNode({});
    }

    const updateRecursive = (path: string[], value: unknown) => {
        if (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
        ) {
            for (const [key, val] of Object.entries(value)) {
                updateRecursive([...path, key], val);
            }
        } else {
            configDoc.setIn(path, value);
        }
    };

    // Explicitly handle root-level scalar values like jwtSecret
    for (const [key, value] of Object.entries(config)) {
        if (value !== undefined) {
            updateRecursive([key], value);
        }
    }
}

loadConfig();

export function saveConfig() {
    try {
        syncDoc();
        const yamlOutput = configDoc.toString();
        fs.writeFileSync(CONFIG_PATH, yamlOutput);
    } catch (e) {
        logger.error(
            { err: e, path: CONFIG_PATH },
            "Failed to save config.yaml",
        );
        throw e;
    }
}

if (!config.jwtSecret) {
    logger.info("No JWT secret found in config.yaml, generating a new one...");
    config.jwtSecret = crypto.randomBytes(64).toString("hex");
    try {
        saveConfig();
        logger.info("Generated new JWT secret and saved to config.yaml");
    } catch (e) {
        logger.error(
            { err: e },
            "Failed to save generated JWT secret to config.yaml",
        );
    }
}

/** The keys the server reads, per block; `""` is the top level. */
const KNOWN_KEYS: Record<string, string[]> = {
    "": Object.keys(AppConfigSchema.shape),
    settings: Object.keys(AppSettingsSchema.unwrap().shape),
    oidc: Object.keys(OidcConfigSchema.shape),
    security: Object.keys(SecurityConfigSchema.unwrap().shape),
    directory: Object.keys(DirectoryConfigSchema.unwrap().shape),
    health: Object.keys(HealthConfigSchema.unwrap().shape),
};

/**
 * Logs every key in config.yaml the server does not read, so a typo -- `hst` for `hsts` --
 * does not leave a default in force without a word. Only a warning: the schemas are loose
 * on purpose, and an operator's own additions stay in the file.
 */
function warnUnknownKeys(raw: Record<string, unknown>) {
    for (const [block, known] of Object.entries(KNOWN_KEYS)) {
        const value = block === "" ? raw : raw[block];
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        for (const key of Object.keys(value)) {
            if (known.includes(key)) continue;
            logger.warn(
                { path: CONFIG_PATH, key: block === "" ? key : `${block}.${key}` },
                "Unknown key in config.yaml -- ignored",
            );
        }
    }
}

/**
 * Checks config.yaml and fills in every default, once, at startup.
 *
 * Runs after the secrets above exist and before anything reads a value. A configuration
 * error is a startup failure, not something to discover when a scheduler first reads a
 * value hours later -- and not something to paper over with a default, because a server
 * quietly running on defaults the operator did not choose is worse than one that refuses
 * to start and says which field is wrong.
 */
function validateConfig(): AppConfig {
    const parsed = AppConfigSchema.safeParse(config);
    if (!parsed.success) {
        logger.fatal(
            { path: CONFIG_PATH },
            `Invalid config.yaml -- ${firstIssue(parsed.error)}`,
        );
        process.exit(1);
    }
    warnUnknownKeys(config);
    config = parsed.data;

    if (newDefaultsAdded && fs.existsSync(CONFIG_PATH)) {
        try {
            saveConfig();
        } catch {
            // Already logged by saveConfig(). A read-only file is no reason to refuse
            // service: the values are valid, they just cannot be written back.
        }
    }
    return parsed.data;
}

export const appConfig: AppConfig = validateConfig();

// Applied only now: pino throws on an unknown level, and the schema has checked it.
if (!process.env.LOG_LEVEL && appConfig.logLevel) {
    logger.level = appConfig.logLevel;
}

/**
 * Reads the listen port from config.yaml or SADM_SERVER_PORT. The environment wins, so a
 * container needs one variable rather than a mounted config file just to move the port.
 *
 * A value that is not a port is refused rather than silently replaced by the default: a
 * server listening somewhere other than where its operator put it is the harder fault to
 * find. Node reads port 0 as "any free port", which is never what this setting means.
 */
function resolveServerPort(): number {
    const raw = process.env.SADM_SERVER_PORT ?? appConfig.port;
    if (raw === undefined || raw === null || raw === "") return DEFAULT_SERVER_PORT;

    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        logger.fatal(
            { value: raw },
            "Invalid listen port -- expected an integer between 1 and 65535",
        );
        process.exit(1);
    }
    return port;
}

export const serverPort: number = resolveServerPort();

/**
 * Reads the trusted reverse proxies from config.yaml or SADM_TRUSTED_PROXIES (comma
 * separated). The environment wins, as it does for the port, so a container behind a proxy
 * needs no config file edit to say so.
 *
 * Read once, at startup: Fastify takes `trustProxy` when the instance is created. An
 * unusable entry in the variable ends the start -- the file's entries are already checked
 * by AppConfigSchema.
 */
function resolveTrustedProxies(): string[] {
    const raw = process.env.SADM_TRUSTED_PROXIES;
    if (raw === undefined || raw.trim() === "") {
        return appConfig.security.trusted_proxies;
    }

    const entries = raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
    for (const entry of entries) {
        if (!TrustedProxySchema.safeParse(entry).success) {
            logger.fatal(
                { value: entry },
                "Invalid SADM_TRUSTED_PROXIES entry -- expected an IP address, a CIDR network, or loopback, linklocal, uniquelocal",
            );
            process.exit(1);
        }
    }
    return entries;
}

export const trustedProxies: string[] = resolveTrustedProxies();

/**
 * A secret that comes from the environment only: `<name>`, or `<name>_FILE` naming a file
 * that holds it (a Docker or Podman secret).
 *
 * Fatal when both are set or the file cannot be read or is empty: a server that started
 * without the secret it was given would fail later, somewhere that no longer says why.
 */
function readSecretFromEnv(name: string): string | null {
    const value = process.env[name]?.trim() || null;
    const file = process.env[`${name}_FILE`]?.trim() || null;
    if (value && file) {
        logger.fatal(`Set ${name} or ${name}_FILE, not both`);
        process.exit(1);
    }
    if (!file) return value;

    let content: string;
    try {
        content = fs.readFileSync(path.resolve(path.dirname(CONFIG_PATH), file), "utf8").trim();
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        logger.fatal(`${name}_FILE cannot be read at ${file}${code ? ` (${code})` : ""}`);
        process.exit(1);
    }
    if (!content) {
        logger.fatal(`${name}_FILE is empty: ${file}`);
        process.exit(1);
    }
    return content;
}

/**
 * How the directory is reached: the `directory` block of config.yaml with the environment
 * laid over it (`SADM_LDAP_URLS` and `SADM_LDAP_SERVICE_URLS`, comma separated;
 * `SADM_LDAP_BIND_DN`; `SADM_LDAP_CA_FILE`;
 * `SADM_LDAP_ALLOW_SELF_SIGNED`), so a container needs no mounted file to be pointed at a
 * domain. Kept apart from `appConfig`: that object is written back to the file, and a value
 * from the environment must not end up there.
 *
 * `enabled` and `readOnly` are read from the file alone. They are what limits this server,
 * and the place that decides them should be one an operator looks at on purpose.
 */
function resolveDirectoryConfig(): AppConfig["directory"] & { password: string | null } {
    const directory = { ...appConfig.directory };
    const env = (name: string) => process.env[name]?.trim() || null;

    /** A comma separated list of URLs, each checked: one that is wrong stops the server. */
    const urlList = (name: string, schema: typeof LdapsUrlSchema | typeof LdapServiceUrlSchema, expected: string) => {
        const list = env(name)
            ?.split(",")
            .map((url) => url.trim())
            .filter((url) => url !== "");
        for (const url of list ?? []) {
            if (!schema.safeParse(url).success) {
                logger.fatal({ value: url }, `Invalid ${name} entry -- expected ${expected}`);
                process.exit(1);
            }
        }
        return list;
    };

    directory.urls = urlList("SADM_LDAP_URLS", LdapsUrlSchema, "ldaps://host[:port]") ?? directory.urls;
    directory.serviceUrls =
        urlList("SADM_LDAP_SERVICE_URLS", LdapServiceUrlSchema, "ldap://host[:port] or ldaps://host[:port]") ?? directory.serviceUrls;
    directory.bindDn = env("SADM_LDAP_BIND_DN") ?? directory.bindDn;
    directory.caFile = env("SADM_LDAP_CA_FILE") ?? directory.caFile;
    if (env("SADM_LDAP_ALLOW_SELF_SIGNED")) directory.allowSelfSigned = env("SADM_LDAP_ALLOW_SELF_SIGNED") === "true";

    return { ...directory, password: readSecretFromEnv("SADM_LDAP_PASSWORD") };
}

/**
 * The directory as this server is told to reach it. `password` is that of `bindDn`:
 * `SADM_LDAP_PASSWORD` or `SADM_LDAP_PASSWORD_FILE`, never config.yaml -- that file is
 * rewritten by the settings page and passed around by operators.
 */
export const directoryConfig = resolveDirectoryConfig();

/** The CA file a domain controller's certificate is checked against besides the public CAs; undefined without one. */
export function readDirectoryCa(): Buffer | undefined {
    if (!directoryConfig.caFile) return undefined;
    return fs.readFileSync(path.resolve(path.dirname(CONFIG_PATH), directoryConfig.caFile));
}

export function updateConfig(updates: Partial<AppConfig>) {
    Object.assign(appConfig, updates);
    config = appConfig;
    saveConfig();
}

/**
 * The OIDC block, if it is switched on. The schema has checked the fields at startup, but
 * TypeScript cannot follow that from `enabled` to the fields, so callers get them narrowed.
 */
export function getEnabledOidcSettings(): {
    issuer: string;
    client_id: string;
    client_secret: string;
    redirect_uri: string;
} | null {
    const oidc = appConfig.oidc;
    if (!oidc?.enabled) return null;
    return {
        issuer: oidc.issuer as string,
        client_id: oidc.client_id as string,
        client_secret: oidc.client_secret as string,
        redirect_uri: oidc.redirect_uri as string,
    };
}

let oidcConfig: client.Configuration | null = null;

export async function initOIDC() {
    const oidc = getEnabledOidcSettings();
    if (oidc) {
        try {
            oidcConfig = await client.discovery(
                new URL(oidc.issuer),
                oidc.client_id,
                oidc.client_secret,
            );
            logger.info("OIDC Client initialized");
        } catch (e) {
            logger.error({ err: e }, "Failed to initialize OIDC client");
        }
    }
}

export function getOidcConfig() {
    return oidcConfig;
}
