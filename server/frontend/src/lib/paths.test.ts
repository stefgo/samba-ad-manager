import { describe, expect, it } from "vitest";
import { activitySearch, paths } from "./paths";

describe("paths", () => {
    it("fills a pattern with its parameter", () => {
        expect(paths.domainController("h1")).toBe("/domain-controllers/h1");
        expect(paths.webhook("w1")).toBe("/webhooks/w1");
    });

    it("encodes what a path segment cannot carry", () => {
        expect(paths.webhook("a/b")).toBe("/webhooks/a%2Fb");
    });
});

describe("activitySearch", () => {
    it("names the search in the query of the activity list", () => {
        expect(activitySearch("dc1")).toEqual({ pathname: "/activity", search: "?search=dc1" });
    });
});
