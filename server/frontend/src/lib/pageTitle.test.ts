import { describe, expect, it } from "vitest";
import { pageTitle, routeTitle, type TitleSubject } from "./pageTitle";

const names = (known: Partial<Record<TitleSubject, string>>) => (subject: TitleSubject) => known[subject];

describe("pageTitle", () => {
    it("ends in the name of the application", () => {
        expect(pageTitle(["dc1", "Domain Controllers"])).toBe("dc1 · Domain Controllers · SADM");
    });

    it("is the name of the application alone when nothing names the page", () => {
        expect(pageTitle([])).toBe("SADM");
    });

    it("leaves out a part that is missing", () => {
        expect(pageTitle([undefined, "Domain Controllers", null, ""])).toBe("Domain Controllers · SADM");
    });
});

describe("routeTitle", () => {
    const area = { nav: { label: "Domain Controllers" } };

    it("names the area on its list", () => {
        expect(routeTitle([area, undefined], names({}))).toBe("Domain Controllers · SADM");
    });

    it("puts the subject in front of its area", () => {
        expect(routeTitle([area, { subject: "domainController" }, undefined], names({ domainController: "dc1" }))).toBe(
            "dc1 · Domain Controllers · SADM",
        );
    });

    it("puts a route below the subject in front of it", () => {
        expect(routeTitle([area, { subject: "domainController" }, { title: "Edit" }], names({ domainController: "dc1" }))).toBe(
            "Edit · dc1 · Domain Controllers · SADM",
        );
    });

    it("calls a route by its title until its subject has a name", () => {
        const handles = [area, { subject: "domainController" as const, title: "Domain Controller" }];
        expect(routeTitle(handles, names({ domainController: "dc1" }))).toBe("dc1 · Domain Controllers · SADM");
        expect(routeTitle(handles, names({}))).toBe("Domain Controller · Domain Controllers · SADM");
    });

    it("leaves out a subject that has neither a name nor a title", () => {
        expect(routeTitle([area, { subject: "domainController" }], names({}))).toBe("Domain Controllers · SADM");
    });

    it("is the name of the application outside every area", () => {
        expect(routeTitle([undefined], names({}))).toBe("SADM");
    });
});
