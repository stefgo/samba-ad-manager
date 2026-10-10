import pino from "pino";

/**
 * The pino setup both the server and the agent run on.
 *
 * It used to exist twice, byte for byte, as core/logger.ts in each workspace. The copies
 * agreed, but the libraries behind them did not: the backend resolved its own pino@9,
 * while the Fastify instance it hands `loggerOptions` to resolved pino@10 -- one process,
 * two majors of the same library. Living here, both workspaces and Fastify share one.
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
