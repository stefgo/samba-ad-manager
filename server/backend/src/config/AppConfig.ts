import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as client from "openid-client";
import YAML from "yaml";
import { logger } from "@sadm/shared/node";
import {
    AppConfigSchema,
    AppSettingsSchema,
    DEFAULT_SERVER_PORT,
    firstIssue,
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
 * True while a secretKey generated on this start exists only in memory. Anything encrypted
 * with it would be unreadable after the next restart -- see secretKeyPersisted(). Cleared
 * by the next successful save.
 */
let secretKeyUnsaved = false;

/**
 * Reads config.yaml as it stands, without filling anything in: defaults belong to
 * AppConfigSchema, and that cannot run yet -- jwtSecret and secretKey are generated below on
 * first start, and validating before that would reject every fresh installation.
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
        secretKeyUnsaved = false;
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

if (!config.secretKey) {
    logger.info("No secret key found in config.yaml, generating a new one...");
    config.secretKey = crypto.randomBytes(32).toString("hex");
    secretKeyUnsaved = true;
    try {
        saveConfig();
        logger.info("Generated new secret key and saved to config.yaml");
    } catch (e) {
        logger.error(
            { err: e },
            "Failed to save generated secret key to config.yaml",
        );
    }
}

/** The keys the server reads, per block; `""` is the top level. */
const KNOWN_KEYS: Record<string, string[]> = {
    "": Object.keys(AppConfigSchema.shape),
    settings: Object.keys(AppSettingsSchema.unwrap().shape),
    oidc: Object.keys(OidcConfigSchema.shape),
    security: Object.keys(SecurityConfigSchema.unwrap().shape),
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

/**
 * Whether secretKey is on disk. A start that generated the key and could not write it
 * (read-only file, missing bind mount) runs on a key that is gone after the restart, and
 * with it every secret encrypted in between. SecretCrypto refuses to encrypt in that state.
 */
export function secretKeyPersisted(): boolean {
    return !secretKeyUnsaved;
}

// Applied only now: pino throws on an unknown level, and the schema has checked it.
if (!process.env.LOG_LEVEL && appConfig.logLevel) {
    logger.level = appConfig.logLevel;
}

/**
 * Reads the listen port from config.yaml or SADM_SERVER_PORT. The environment wins, so a
 * container needs one variable rather than a mounted config file just to move the port.
 * The agent reads its own port exactly this way (see resolveListenPort in client/src/core).
 *
 * A value that is not a port is refused rather than silently replaced by the default: a
 * server listening somewhere other than where its operator put it takes every agent with
 * it. Node reads port 0 as "any free port", which is never what this setting means.
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
