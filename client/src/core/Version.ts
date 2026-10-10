import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
            return execSync("git describe --tags --exact-match --dirty")
                .toString()
                .trim();
        } catch {
            // Not a tag, use branch + hash
            const branch = execSync("git rev-parse --abbrev-ref HEAD")
                .toString()
                .trim();
            const hash = execSync("git rev-parse --short HEAD")
                .toString()
                .trim();
            const dirty = execSync("git status --porcelain").toString().trim()
                ? "-dirty"
                : "";
            return `${branch}-${hash}${dirty}`;
        }
    } catch {
        return "unknown";
    }
};

export const VERSION = getClientVersion();
