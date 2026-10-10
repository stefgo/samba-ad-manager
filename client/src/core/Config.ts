import path from "path";
import fs from "fs";
import { logger } from "@sadm/shared/node";
import {
    AgentConfigParsed,
    AgentConfigSchema,
    LogLevelSchema,
    firstIssue,
} from "@sadm/shared";
import { CONFIG_PATH, ROOT_DIR, load } from "./ConfigFile.js";

export { CONFIG_PATH };

/**
 * What the operator wrote, read once at startup and frozen: `config` is the file, not the
 * agent's state. Everything the agent itself changes has its own owner -- the identity the
 * server issued lives in Identity.ts, the server URL in RegistrationState.ts, both of which
 * know how to persist what they hold. The registration secret is not in `config` either: it
 * comes from the environment only (`REGISTRATION_SECRET` below).
 *
 * The separation is the point. A value that can be written into `config` at runtime reads
 * afterwards as though the operator had put it there, and that is how the auth token ended
 * up in a hand-maintained YAML file in the first place.
 */
export type ClientConfig = AgentConfigParsed;

/**
 * A log level, or undefined when the value is not one. Wrong levels are tolerated rather
 * than fatal -- an agent that refuses to start over the verbosity of its own log is worse
 * than one that logs at `info` and says why.
 */
function pickLogLevel(value: unknown, source: string): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const level = LogLevelSchema.safeParse(value);
    if (level.success) return level.data;
    logger.warn({ value }, `Ignoring the log level from ${source}: not a pino level`);
    return undefined;
}

/**
 * The raw file with the environment laid over it, ready for the schema.
 *
 * Two kinds of value are settled here rather than in the schema. The environment wins over
 * the file for the port and for where Samba and its directory are, so a container can be
 * set up without a mounted config file. And the two tolerated settings --
 * `logLevel` and `allowSelfSignedCertificates` -- lose a wrong value with a warning here,
 * so the schema behind this can stay strict about everything it does see.
 */
function prepare(raw: unknown): Record<string, unknown> {
    const out: Record<string, unknown> =
        raw && typeof raw === "object" && !Array.isArray(raw)
            ? { ...(raw as Record<string, unknown>) }
            : {};

    const port = process.env.SADM_CLIENT_PORT?.trim();
    if (port) out.listenPort = port;
    // An empty `listenPort:` is a key the operator left blank, not a port of zero.
    if (out.listenPort === null || out.listenPort === "") delete out.listenPort;

    // What a container is told through its environment instead of a mounted file: which
    // Samba container and which directory this agent belongs to.
    const block = (name: string): Record<string, unknown> => {
        const value = out[name];
        return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
    };
    const env = (name: string) => process.env[name]?.trim() || undefined;
    const samba = block("samba");
    const ldap = block("ldap");
    if (env("SADM_SAMBA_CONTAINER")) samba.container = env("SADM_SAMBA_CONTAINER");
    if (env("SADM_DOCKER_SOCKET")) samba.dockerSocket = env("SADM_DOCKER_SOCKET");
    if (env("SADM_LDAP_URL")) ldap.url = env("SADM_LDAP_URL");
    if (env("SADM_LDAP_BIND_DN")) ldap.bindDn = env("SADM_LDAP_BIND_DN");
    if (env("SADM_LDAP_CA_FILE")) ldap.caFile = env("SADM_LDAP_CA_FILE");
    if (env("SADM_LDAP_ALLOW_SELF_SIGNED")) ldap.allowSelfSigned = env("SADM_LDAP_ALLOW_SELF_SIGNED") === "true";
    out.samba = samba;
    out.ldap = ldap;

    // The file wins over LOG_LEVEL, which is the order this has always had: the variable is
    // the fallback for an agent whose config.yaml says nothing about logging.
    const level =
        pickLogLevel(out.logLevel, "config.yaml") ??
        pickLogLevel(process.env.LOG_LEVEL, "LOG_LEVEL");
    if (level) out.logLevel = level;
    else delete out.logLevel;

    if (
        out.allowSelfSignedCertificates !== undefined &&
        out.allowSelfSignedCertificates !== null &&
        typeof out.allowSelfSignedCertificates !== "boolean"
    ) {
        logger.warn(
            "Ignoring allowSelfSignedCertificates in config.yaml: expected true or false",
        );
        delete out.allowSelfSignedCertificates;
    }

    // Read by earlier versions for outbound registration. Dropped with a warning rather than
    // ignored silently: an operator who set it expects it to work, and the wizard will now
    // ask for the setup PIN instead.
    if (out.registrationSecret !== undefined && out.registrationSecret !== null) {
        logger.warn(
            "Ignoring registrationSecret in config.yaml: it is no longer read. Register with the " +
                "setup PIN from this log, or set SADM_REGISTRATION_SECRET instead.",
        );
    }
    delete out.registrationSecret;

    return out;
}

/**
 * Checks that a configured certificate and key can be read, and stops the agent when they
 * cannot.
 *
 * Fatal, unlike the settings around it. An agent configured for TLS that fell back to HTTP
 * would serve `/ws/register` -- the route that hands it its auth token -- in the clear, and
 * would look exactly like a working agent while doing it. It is checked at startup rather
 * than at listen(), because a path that is wrong is wrong now, not when the server first
 * dials hours later.
 */
function checkTlsFiles(tls: { cert: string; key: string } | undefined): void {
    if (!tls) return;
    for (const field of ["cert", "key"] as const) {
        const file = path.resolve(ROOT_DIR, tls[field]);
        try {
            fs.readFileSync(file);
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            logger.fatal(
                { path: CONFIG_PATH },
                `Invalid config.yaml -- tls.${field} cannot be read at ${file}${code ? ` (${code})` : ""}`,
            );
            process.exit(1);
        }
    }
}

function loadConfig(): ClientConfig {
    const parsed = AgentConfigSchema.safeParse(prepare(load()));
    if (!parsed.success) {
        logger.fatal(
            { path: CONFIG_PATH },
            `Invalid config.yaml -- ${firstIssue(parsed.error)}`,
        );
        process.exit(1);
    }
    checkTlsFiles(parsed.data.tls);
    return Object.freeze(parsed.data);
}

export const config: ClientConfig = loadConfig();

logger.level = config.logLevel;

/**
 * A secret that comes from the environment only: `<name>`, or `<name>_FILE` naming a file
 * that holds it (a Docker or Podman secret).
 *
 * Fatal when both are set or the file cannot be read or is empty: an agent that started
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
        content = fs.readFileSync(path.resolve(ROOT_DIR, file), "utf8").trim();
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
 * The secret the server may present on `/ws/register` instead of the setup PIN, for a rollout
 * where nobody reads the agent's log: `SADM_REGISTRATION_SECRET` or
 * `SADM_REGISTRATION_SECRET_FILE`.
 */
export const REGISTRATION_SECRET: string | null = readSecretFromEnv("SADM_REGISTRATION_SECRET");

/**
 * The password of `ldap.bindDn`: `SADM_LDAP_PASSWORD` or `SADM_LDAP_PASSWORD_FILE`. Not in
 * config.yaml, which the agent rewrites and an operator passes around.
 */
export const LDAP_PASSWORD: string | null = readSecretFromEnv("SADM_LDAP_PASSWORD");

/** The CA the domain controller's certificate is checked against, or undefined for the system's. */
export function readLdapCa(): Buffer | undefined {
    if (!config.ldap.caFile) return undefined;
    return fs.readFileSync(path.resolve(ROOT_DIR, config.ldap.caFile));
}

/**
 * The certificate and key as Fastify wants them, or undefined for a plain HTTP agent.
 *
 * Read on demand instead of being kept in `config`: what is stored there is what the
 * operator wrote, so a relative path stays the relative path they chose. `checkTlsFiles` has
 * already established that both files can be read, so a throw here means they changed
 * underneath a running agent.
 */
export function readTlsMaterial(): { cert: Buffer; key: Buffer } | undefined {
    if (!config.tls) return undefined;
    return {
        cert: fs.readFileSync(path.resolve(ROOT_DIR, config.tls.cert)),
        key: fs.readFileSync(path.resolve(ROOT_DIR, config.tls.key)),
    };
}
