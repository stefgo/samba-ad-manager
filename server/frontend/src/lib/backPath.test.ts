import { describe, expect, it } from "vitest";
import { parentPath } from "./backPath";

describe("parentPath", () => {
    it("is the route above an editor", () => {
        expect(parentPath(["/", "/clients", "/clients/a", "/clients/a/edit"])).toBe("/clients/a");
        expect(parentPath(["/", "/clients", "/clients/new"])).toBe("/clients");
        expect(parentPath(["/", "/webhooks", "/webhooks/w1"])).toBe("/webhooks");
    });

    it("skips path segments that are no route of their own", () => {
        // There is no `/webhooks/dc1` in the tree, so that is not where back is.
        expect(parentPath(["/", "/webhooks", "/webhooks/dc1/51"])).toBe("/webhooks");
    });

    it("looks past an index route, which repeats its parent with a trailing slash", () => {
        expect(parentPath(["/", "/clients", "/clients/a", "/clients/a/"])).toBe("/clients");
        expect(parentPath(["/", "/clients", "/clients/"])).toBe("/");
    });

    it("looks past layout routes without a path", () => {
        expect(parentPath(["/", "/", "/clients", "/clients/a", "/clients/a/edit"])).toBe("/clients/a");
    });

    it("is the root for a page directly below it, and for nothing at all", () => {
        expect(parentPath(["/", "/activity"])).toBe("/");
        expect(parentPath(["/"])).toBe("/");
        expect(parentPath([])).toBe("/");
    });
});
