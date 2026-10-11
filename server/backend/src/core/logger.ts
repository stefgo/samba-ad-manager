import pino from "pino";

/**
 * The server's pino setup: the standalone logger, and the options Fastify builds its own
 * from -- so both resolve the one pino this workspace depends on.
 */

const isDev = process.env.NODE_ENV !== "production";

// Determine if we should use pretty printing
// Priority:
// 1. LOG_FORMAT env var (if set to 'json', forces json. if set to 'pretty', forces pretty)
// 2. NODE_ENV (dev -> pretty, prod -> json)
const logFormat = process.env.LOG_FORMAT?.toLowerCase();
const usePrettyParam = logFormat === "pretty" || logFormat === "one-line";
const forceJson = logFormat === "json";

const usePretty = (isDev && !forceJson) || usePrettyParam;

/**
 * Passed to Fastify as its own logger configuration as well as used for the standalone
 * logger below, so application lines and the request log look the same.
 */
export const loggerOptions = {
    level: process.env.LOG_LEVEL || "info",
    transport: usePretty
        ? {
              // Loaded by name in a worker thread rather than imported, so `pino-pretty`
              // has to stay a dependency of this package even though no file imports it.
              target: "pino-pretty",
              options: {
                  translateTime: "HH:MM:ss",
                  ignore: "pid,hostname",
                  singleLine: true,
              },
          }
        : undefined,
};

export const logger = pino(loggerOptions);
