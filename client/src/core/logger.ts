import pino from "pino";

/**
 * The agent's pino setup. JSON in production, one readable line per entry otherwise;
 * `LOG_FORMAT` (`json`, `pretty`) says so explicitly.
 */

const isDev = process.env.NODE_ENV !== "production";
const logFormat = process.env.LOG_FORMAT?.toLowerCase();
const usePretty = logFormat === "pretty" || logFormat === "one-line" || (isDev && logFormat !== "json");

export const logger = pino({
    level: process.env.LOG_LEVEL || "info",
    transport: usePretty
        ? {
              // Loaded by name in a worker thread rather than imported, so `pino-pretty`
              // has to stay a dependency of this package even though no file imports it.
              target: "pino-pretty",
              options: { translateTime: "HH:MM:ss", ignore: "pid,hostname", singleLine: true },
          }
        : undefined,
});
