import { describe, expect, it } from "vitest";
import { toSupervisedProcess, trackStarts } from "./supervisor.js";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const at = (minutesAgo: number) => Math.floor((NOW - minutesAgo * 60_000) / 1000);

describe("toSupervisedProcess", () => {
    it("reads a running program", () => {
        expect(toSupervisedProcess({ name: "samba", group: "samba", statename: "RUNNING", state: 20, pid: 41, start: at(90), exitstatus: 0 })).toEqual({
            name: "samba",
            state: "RUNNING",
            pid: 41,
            startedAt: new Date(at(90) * 1000).toISOString(),
            exitStatus: null,
            startSeconds: at(90),
        });
    });

    it("keeps the exit status of one that is not running, and has no pid for it", () => {
        expect(toSupervisedProcess({ name: "bind", statename: "FATAL", pid: 0, start: 0, exitstatus: 2 })).toMatchObject({
            state: "FATAL",
            pid: null,
            startedAt: null,
            exitStatus: 2,
        });
    });

    it("refuses an entry without a name", () => {
        expect(() => toSupervisedProcess({ statename: "RUNNING" })).toThrow();
    });
});

describe("trackStarts", () => {
    it("counts each start once, however often it is seen", () => {
        let seen = trackStarts(new Map(), [{ name: "samba", startSeconds: at(10) }], NOW);
        seen = trackStarts(seen, [{ name: "samba", startSeconds: at(10) }], NOW);
        expect(seen.get("samba")).toHaveLength(1);
    });

    it("counts a program that keeps starting", () => {
        let seen = new Map<string, number[]>();
        for (const minutes of [50, 30, 10]) seen = trackStarts(seen, [{ name: "samba", startSeconds: at(minutes) }], NOW);
        expect(seen.get("samba")).toHaveLength(3);
    });

    it("forgets a start once it is more than an hour old, and never counts one that was", () => {
        const seen = trackStarts(new Map([["samba", [at(70), at(20)]]]), [{ name: "samba", startSeconds: at(20) }], NOW);
        expect(seen.get("samba")).toEqual([at(20)]);
        expect(trackStarts(new Map(), [{ name: "bind", startSeconds: at(600) }], NOW).get("bind")).toEqual([]);
    });

    it("drops a program supervisord no longer lists", () => {
        expect(trackStarts(new Map([["gone", [at(5)]]]), [], NOW).has("gone")).toBe(false);
    });
});
