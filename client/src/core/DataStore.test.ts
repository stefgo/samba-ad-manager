import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every test gets a data directory of its own under the system's temporary directory.
// DataStore reads SADM_CLIENT_DATA_DIR when it is imported, so the module is imported anew.
let dataDir: string;

async function freshStore() {
    vi.resetModules();
    return import("./DataStore.js");
}

const entries = () => fs.readdirSync(dataDir).sort();
const modeOf = (name: string) => fs.statSync(path.join(dataDir, name)).mode & 0o777;

beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sadm-datastore-"));
    vi.stubEnv("SADM_CLIENT_DATA_DIR", dataDir);
});

afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("writeJsonFile", () => {
    it("writes what readJsonFile reads back and leaves no temporary file", async () => {
        const store = await freshStore();

        expect(store.writeJsonFile("state.json", { a: 1 })).toBe(true);
        expect(store.readJsonFile("state.json")).toEqual({ a: 1 });
        expect(entries()).toEqual(["state.json"]);
    });

    it("keeps the file to the agent, even over a leftover that was readable by all", async () => {
        const store = await freshStore();
        fs.writeFileSync(path.join(dataDir, "state.json.tmp"), "left over", { mode: 0o644 });

        store.writeJsonFile("state.json", { a: 1 });

        expect(modeOf("state.json")).toBe(0o600);
    });

    it("answers false and leaves the old content when the write cannot happen", async () => {
        const store = await freshStore();
        store.writeJsonFile("state.json", { a: 1 });
        // A directory where the temporary file would go: opening it for writing fails.
        fs.mkdirSync(path.join(dataDir, "state.json.tmp"));

        expect(store.writeJsonFile("state.json", { a: 2 })).toBe(false);
        expect(store.readJsonFile("state.json")).toEqual({ a: 1 });
    });
});

describe("readJsonFile", () => {
    it("answers null for a file that is not there", async () => {
        const store = await freshStore();

        expect(store.readJsonFile("missing.json", { quarantine: true })).toBeNull();
        expect(entries()).toEqual([]);
    });

    it("discards a damaged file but leaves it in place", async () => {
        const store = await freshStore();
        fs.writeFileSync(path.join(dataDir, "state.json"), "{ not json");

        expect(store.readJsonFile("state.json")).toBeNull();
        expect(entries()).toEqual(["state.json"]);
    });

    it("sets a damaged file aside with its content when asked to", async () => {
        const store = await freshStore();
        fs.writeFileSync(path.join(dataDir, "identity.json"), "{ not json");

        expect(store.readJsonFile("identity.json", { quarantine: true })).toBeNull();

        const [moved, ...rest] = entries();
        expect(rest).toEqual([]);
        expect(moved).toMatch(/^identity\.json\.corrupt-\d{4}-\d{2}-\d{2}T[\d-]+Z$/);
        expect(fs.readFileSync(path.join(dataDir, moved), "utf-8")).toBe("{ not json");
    });

    it("lets the next write start a new file next to the one set aside", async () => {
        const store = await freshStore();
        fs.writeFileSync(path.join(dataDir, "identity.json"), "{ not json");
        store.readJsonFile("identity.json", { quarantine: true });

        store.writeJsonFile("identity.json", { clientId: "c", authToken: "t" });

        expect(entries()).toHaveLength(2);
        expect(store.readJsonFile("identity.json")).toEqual({ clientId: "c", authToken: "t" });
    });
});

describe("quarantineFile", () => {
    it("answers null when there is nothing to move", async () => {
        const store = await freshStore();

        expect(store.quarantineFile("missing.json")).toBeNull();
    });
});

describe("ensureDataDir", () => {
    it("creates the directory for the agent alone", async () => {
        const store = await freshStore();
        fs.rmSync(dataDir, { recursive: true });

        store.ensureDataDir();

        expect(fs.statSync(dataDir).mode & 0o777).toBe(0o700);
    });

    it("tightens a directory that is already there", async () => {
        const store = await freshStore();
        fs.chmodSync(dataDir, 0o755);

        store.ensureDataDir();

        expect(fs.statSync(dataDir).mode & 0o777).toBe(0o700);
    });
});
