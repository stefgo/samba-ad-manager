/**
 * Node-only exports, reachable as `@sadm/shared/node`.
 *
 * Deliberately a separate entry point rather than part of the package's main index. That
 * index is imported by the frontend, and everything here pulls in something a browser has
 * no use for -- `pino` above all. Re-export any of it from `../index.ts` and it lands in the
 * browser bundle.
 *
 * The rule for what belongs here is therefore the runtime, not the topic: pure string or
 * schema work goes into the main index, anything that needs Node goes here.
 */
export * from "./logger.js";
