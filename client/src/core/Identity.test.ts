import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ConfigFile reads config.yaml when it is imported. Nothing here has an identity left in it.
vi.mock("./ConfigFile.js", () => ({
    CONFIG_PATH: "config.yaml",
    rawValue: () => undefined,
    removeKey: () => undefined,
    save: () => true,
}));

// Identity reads its file when it is imported, so every test imports it anew, over a data
// directory of its own.
let dataDir: string;

async function freshIdentity() {
    vi.resetModules();
    return import("./Identity.js");
}

const identityFile = () => path.join(dataDir, "identity.json");
const entries = () => fs.readdirSync(dataDir).sort();

beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sadm-identity-"));
    vi.stubEnv("SADM_CLIENT_DATA_DIR", dataDir);
});

afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("the stored identity", () => {
    it("is read back at the next start", async () => {
        const first = await freshIdentity();
        expect(first.getIdentity()).toBeNull();
        expect(first.setIdentity("client-1", "token-1")).toBe(true);

        const second = await freshIdentity();
        expect(second.getIdentity()).toEqual({ clientId: "client-1", authToken: "token-1" });
        expect(fs.statSync(identityFile()).mode & 0o777).toBe(0o600);
    });

    it("is set aside, not discarded, when the file is not JSON", async () => {
        fs.writeFileSync(identityFile(), '{"clientId":"client-1","authTo');

        const { getIdentity } = await freshIdentity();

        expect(getIdentity()).toBeNull();
        const [moved, ...rest] = entries();
        expect(rest).toEqual([]);
        expect(moved).toMatch(/^identity\.json\.corrupt-/);
        expect(fs.readFileSync(path.join(dataDir, moved), "utf-8")).toBe(
            '{"clientId":"client-1","authTo',
        );
    });

    it("is set aside when the file is JSON but not the pair", async () => {
        fs.writeFileSync(identityFile(), JSON.stringify({ clientId: "client-1" }));

        const { getIdentity } = await freshIdentity();

        expect(getIdentity()).toBeNull();
        expect(entries()).toHaveLength(1);
        expect(entries()[0]).toMatch(/^identity\.json\.corrupt-/);
    });

    it("survives a new registration next to the file that was set aside", async () => {
        fs.writeFileSync(identityFile(), "{ not json");
        const { setIdentity } = await freshIdentity();

        setIdentity("client-2", "token-2");

        expect(entries()).toHaveLength(2);
        expect((await freshIdentity()).getIdentity()).toEqual({
            clientId: "client-2",
            authToken: "token-2",
        });
    });
});
