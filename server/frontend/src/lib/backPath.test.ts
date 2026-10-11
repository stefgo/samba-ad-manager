import { describe, expect, it } from "vitest";
import { parentPath } from "./backPath";

describe("parentPath", () => {
    it("is the route above an editor", () => {
        expect(parentPath(["/", "/domain-controllers", "/domain-controllers/a", "/domain-controllers/a/edit"])).toBe("/domain-controllers/a");
        expect(parentPath(["/", "/webhooks", "/webhooks/new"])).toBe("/webhooks");
        expect(parentPath(["/", "/webhooks", "/webhooks/w1"])).toBe("/webhooks");
    });

    it("skips path segments that are no route of their own", () => {
        // There is no `/webhooks/dc1` in the tree, so that is not where back is.
        expect(parentPath(["/", "/webhooks", "/webhooks/dc1/51"])).toBe("/webhooks");
    });

    it("looks past an index route, which repeats its parent with a trailing slash", () => {
        expect(parentPath(["/", "/domain-controllers", "/domain-controllers/a", "/domain-controllers/a/"])).toBe("/domain-controllers");
        expect(parentPath(["/", "/domain-controllers", "/domain-controllers/"])).toBe("/");
    });

    it("looks past layout routes without a path", () => {
        expect(parentPath(["/", "/", "/domain-controllers", "/domain-controllers/a", "/domain-controllers/a/edit"])).toBe("/domain-controllers/a");
    });

    it("is the root for a page directly below it, and for nothing at all", () => {
        expect(parentPath(["/", "/activity"])).toBe("/");
        expect(parentPath(["/"])).toBe("/");
        expect(parentPath([])).toBe("/");
    });
});
