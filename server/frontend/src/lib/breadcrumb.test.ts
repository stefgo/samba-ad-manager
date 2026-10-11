import { describe, expect, it } from "vitest";
import { breadcrumb, parentCrumb } from "./breadcrumb";
import type { TitleSubject } from "./pageTitle";

const names = (known: Partial<Record<TitleSubject, string>> = {}) => (subject: TitleSubject) => known[subject];

const shell = { pathname: "/" };
const area = { pathname: "/domain-controllers", handle: { nav: { label: "Domain Controllers" } } };

describe("breadcrumb", () => {
    it("is empty on a list, which has nothing above it", () => {
        expect(breadcrumb([shell, area, { pathname: "/domain-controllers/" }], names())).toEqual([]);
    });

    it("is empty outside every area", () => {
        expect(breadcrumb([shell, { pathname: "/nowhere", handle: { title: "Not Found" } }], names())).toEqual([]);
    });

    it("leads from the area to the subject, which is the open page and no link", () => {
        const matches = [
            shell,
            area,
            { pathname: "/domain-controllers/a", handle: { subject: "domainController" as const } },
            { pathname: "/domain-controllers/a/" },
        ];
        expect(breadcrumb(matches, names({ domainController: "dc1" }))).toEqual([
            { label: "Domain Controllers", to: "/domain-controllers" },
            { label: "dc1" },
        ]);
    });

    it("links every route above a form", () => {
        const matches = [
            shell,
            area,
            { pathname: "/domain-controllers/a", handle: { subject: "domainController" as const } },
            { pathname: "/domain-controllers/a/edit", handle: { title: "Edit" } },
        ];
        expect(breadcrumb(matches, names({ domainController: "dc1" }))).toEqual([
            { label: "Domain Controllers", to: "/domain-controllers" },
            { label: "dc1", to: "/domain-controllers/a" },
            { label: "Edit" },
        ]);
    });

    it("calls a subject by its title until it has a name, and leaves it out without either", () => {
        const titled = { pathname: "/domain-controllers/a", handle: { subject: "domainController" as const, title: "Domain Controller" } };
        expect(breadcrumb([shell, area, titled], names())).toEqual([
            { label: "Domain Controllers", to: "/domain-controllers" },
            { label: "Domain Controller" },
        ]);

        const controller = { pathname: "/domain-controllers/a", handle: { subject: "domainController" as const } };
        expect(breadcrumb([shell, area, controller], names())).toEqual([]);
    });
});

describe("parentCrumb", () => {
    it("is the link before the open page", () => {
        const trail = [{ label: "Domain Controllers", to: "/domain-controllers" }, { label: "dc1", to: "/domain-controllers/a" }, { label: "Edit" }];
        expect(parentCrumb(trail)).toEqual({ label: "dc1", to: "/domain-controllers/a" });
    });

    it("looks past a link that leads nowhere", () => {
        const trail = [{ label: "Domain Controllers", to: "/domain-controllers" }, { label: "dc1" }, { label: "Edit" }];
        expect(parentCrumb(trail)).toEqual({ label: "Domain Controllers", to: "/domain-controllers" });
    });

    it("is nothing without a trail", () => {
        expect(parentCrumb([])).toBeUndefined();
    });
});
