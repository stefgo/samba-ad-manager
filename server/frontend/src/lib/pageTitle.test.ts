import { describe, expect, it } from "vitest";
import { pageTitle, routeTitle, type TitleSubject } from "./pageTitle";

const names = (known: Partial<Record<TitleSubject, string>>) => (subject: TitleSubject) => known[subject];

describe("pageTitle", () => {
    it("ends in the name of the application", () => {
        expect(pageTitle(["dc1", "Clients"])).toBe("dc1 · Clients · SADM");
    });

    it("is the name of the application alone when nothing names the page", () => {
        expect(pageTitle([])).toBe("SADM");
    });

    it("leaves out a part that is missing", () => {
        expect(pageTitle([undefined, "Clients", null, ""])).toBe("Clients · SADM");
    });
});

describe("routeTitle", () => {
    const area = { nav: { label: "Clients" } };

    it("names the area on its list", () => {
        expect(routeTitle([area, undefined], names({}))).toBe("Clients · SADM");
    });

    it("puts the subject in front of its area", () => {
        expect(routeTitle([area, { subject: "client" }, undefined], names({ client: "dc1" }))).toBe(
            "dc1 · Clients · SADM",
        );
    });

    it("puts a route below the subject in front of it", () => {
        expect(routeTitle([area, { subject: "client" }, { title: "Edit" }], names({ client: "dc1" }))).toBe(
            "Edit · dc1 · Clients · SADM",
        );
    });

    it("calls a route by its title until its subject has a name", () => {
        const handles = [area, { subject: "client" as const, title: "Domain Controller" }];
        expect(routeTitle(handles, names({ client: "dc1" }))).toBe("dc1 · Clients · SADM");
        expect(routeTitle(handles, names({}))).toBe("Domain Controller · Clients · SADM");
    });

    it("leaves out a subject that has neither a name nor a title", () => {
        expect(routeTitle([area, { subject: "client" }], names({}))).toBe("Clients · SADM");
    });

    it("is the name of the application outside every area", () => {
        expect(routeTitle([undefined], names({}))).toBe("SADM");
    });
});
