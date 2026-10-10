import { describe, expect, it } from "vitest";
import type { DirectoryContainer } from "@sadm/shared";
import { orderUnits, unitOptionLabel, unitTrail } from "./unitTree";

const BASE = "DC=sadm,DC=test";

const unit = (name: string, parentDn: string | null, type: DirectoryContainer["type"] = "ou"): DirectoryContainer => ({
    guid: name,
    dn: parentDn === null ? BASE : `${type === "ou" ? "OU" : "CN"}=${name},${parentDn}`,
    parentDn,
    name,
    type,
    protected: false,
});

const domain = unit("sadm.test", null, "domain");
const staff = unit("Staff", BASE);
const sales = unit("Sales", staff.dn);
const users = unit("Users", BASE, "container");

describe("orderUnits", () => {
    it("writes the tree top to bottom, siblings by name", () => {
        const ordered = orderUnits([users, sales, domain, staff]);
        expect(ordered.map((node) => [node.name, node.depth, node.hasChildren])).toEqual([
            ["sadm.test", 0, true],
            ["Staff", 1, true],
            ["Sales", 2, false],
            ["Users", 1, false],
        ]);
    });

    it("hangs a container below the domain when its parent is not listed", () => {
        const orphan = unit("Lab", "CN=Hidden,DC=sadm,DC=test");
        expect(orderUnits([domain, orphan]).map((node) => [node.name, node.depth])).toEqual([
            ["sadm.test", 0],
            ["Lab", 1],
        ]);
    });

    it("is empty for nothing", () => {
        expect(orderUnits([])).toEqual([]);
    });
});

describe("unitTrail and unitOptionLabel", () => {
    const ordered = orderUnits([domain, staff, sales, users]);

    it("names the way down to a container", () => {
        expect(unitTrail(ordered, sales.dn)).toBe("sadm.test / Staff / Sales");
        expect(unitTrail(ordered, sales.dn.toLowerCase())).toBe("sadm.test / Staff / Sales");
    });

    it("falls back to the DN for a container it does not know", () => {
        expect(unitTrail(ordered, "OU=Gone,DC=sadm,DC=test")).toBe("OU=Gone,DC=sadm,DC=test");
    });

    it("indents a label by its depth", () => {
        expect(unitOptionLabel(ordered[2])).toBe("      Sales");
    });
});
