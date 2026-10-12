import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Runs git and answers what it printed. What it complains about is not this process's to repeat. */
const git = (args: string): string => execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

/**
 * Retrieves the current version of the client agent.
 */
export const getClientVersion = (): string => {
    try {
        // 1. Try VERSION file in current directory or parent (Docker/dist structure)
        const pathsToTry = [
            path.join(__dirname, "VERSION"),
            path.join(__dirname, "..", "VERSION"),
            path.resolve(process.cwd(), "VERSION"),
            path.resolve(process.cwd(), "dist", "VERSION"),
        ];

        for (const p of pathsToTry) {
            if (fs.existsSync(p)) {
                return fs.readFileSync(p, "utf8").trim();
            }
        }

        // 2. Fallback for development (Git)
        try {
            // Try to get exact tag
            return git("describe --tags --exact-match --dirty");
        } catch {
            // Not a tag, use branch + hash
            const branch = git("rev-parse --abbrev-ref HEAD");
            const hash = git("rev-parse --short HEAD");
            const dirty = git("status --porcelain") ? "-dirty" : "";
            return `${branch}-${hash}${dirty}`;
        }
    } catch {
        return "unknown";
    }
};

export const VERSION = getClientVersion();
