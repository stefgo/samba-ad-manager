import fs from "fs";
import { logger } from "./logger.js";

/**
 * Where the server tells the container's HEALTHCHECK which address to ask. The port comes
 * from config.yaml or SADM_SERVER_PORT, and a one-line probe that repeated that resolution
 * would drift from AppConfig -- and would follow an edited config.yaml before the server had
 * restarted onto it. So the server writes what it actually listens on, and the probe reads
 * that. The probe in docker/Dockerfile.server and in both compose files names the same path.
 *
 * Under /tmp, not the data volume: an address from a previous container must not outlive it.
 */
const HEALTH_FILE = "/tmp/sadm-health.json";

/**
 * Set by the server images. A server installed on the host has no probe that would read the
 * file, and no business writing to its /tmp.
 */
function isRunningInContainer(): boolean {
    return process.env.SADM_CONTAINER === "true";
}

/**
 * Removed before listen() so that a failed start leaves no address from the previous one
 * behind -- the probe would then ask a port that was right once.
 */
export function clearHealthFile(): void {
    if (!isRunningInContainer()) return;
    try {
        fs.rmSync(HEALTH_FILE, { force: true });
    } catch (err) {
        logger.warn({ err, file: HEALTH_FILE }, "Could not remove the health check address");
    }
}

/**
 * Called once listen() has succeeded. The probe has no other way to find the server, so a
 * file that cannot be written leaves the container unhealthy -- logged as an error, but not
 * a reason to stop serving.
 */
export function writeHealthFile(port: number): void {
    if (!isRunningInContainer()) return;
    try {
        const url = `http://127.0.0.1:${port}/api/health`;
        fs.writeFileSync(HEALTH_FILE, JSON.stringify({ url }));
    } catch (err) {
        logger.error(
            { err, file: HEALTH_FILE },
            "Could not write the health check address; the container will report unhealthy",
        );
    }
}
