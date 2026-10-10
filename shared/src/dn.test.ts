import { describe, expect, it } from "vitest";
import { dnsNameOfDn, escapeRdnValue, formatDn, isDnWithin, parentDn, parseDn, parseServerDn, rdnValue } from "./dn.js";

describe("parseDn", () => {
    it("splits a DN into its relative names", () => {
        expect(parseDn("CN=Users,DC=sadm,DC=test")).toEqual([
            { type: "CN", value: "Users" },
            { type: "DC", value: "sadm" },
            { type: "DC", value: "test" },
        ]);
    });

    it("keeps an escaped comma in the value", () => {
        expect(parseDn("CN=Doe\\, Jane,OU=Staff,DC=sadm,DC=test")?.[0]).toEqual({ type: "CN", value: "Doe, Jane" });
    });

    it("reads hex escapes as UTF-8", () => {
        expect(parseDn("CN=J\\c3\\bcrgen,DC=test")?.[0].value).toBe("Jürgen");
        expect(parseDn("CN=a\\2Cb,DC=test")?.[0].value).toBe("a,b");
    });

    it("drops spaces around a value, but not escaped ones", () => {
        expect(parseDn("CN= a b ,DC=test")?.[0].value).toBe("a b");
        expect(parseDn("CN=a\\ ,DC=test")?.[0].value).toBe("a ");
    });

    it("is empty for the root", () => {
        expect(parseDn("")).toEqual([]);
    });

    it("refuses what is no DN", () => {
        expect(parseDn("Users")).toBeNull();
        expect(parseDn("CN=Users,")).toBeNull();
        expect(parseDn(",DC=test")).toBeNull();
        expect(parseDn("CN=a+SN=b,DC=test")).toBeNull();
        expect(parseDn("C N=a,DC=test")).toBeNull();
    });
});

describe("escapeRdnValue and formatDn", () => {
    it("escapes what a DN reserves", () => {
        expect(escapeRdnValue("Doe, Jane")).toBe("Doe\\, Jane");
        expect(escapeRdnValue("a+b=c")).toBe("a\\+b\\=c");
        expect(escapeRdnValue("#first")).toBe("\\#first");
        expect(escapeRdnValue(" lead")).toBe("\\ lead");
        expect(escapeRdnValue("trail ")).toBe("trail\\ ");
    });

    it("writes what parseDn reads", () => {
        for (const dn of ["CN=Doe\\, Jane,OU=Staff,DC=sadm,DC=test", "OU=R\\+D,DC=test", "CN=trail\\ ,DC=test"]) {
            expect(formatDn(parseDn(dn) ?? [])).toBe(dn);
        }
    });
});

describe("parentDn and rdnValue", () => {
    it("go one level up, and name the object", () => {
        expect(parentDn("CN=Doe\\, Jane,OU=Staff,DC=sadm,DC=test")).toBe("OU=Staff,DC=sadm,DC=test");
        expect(rdnValue("CN=Doe\\, Jane,OU=Staff,DC=sadm,DC=test")).toBe("Doe, Jane");
    });

    it("have nothing above the root", () => {
        expect(parentDn("")).toBeNull();
        expect(parentDn("nonsense")).toBeNull();
    });
});

describe("isDnWithin", () => {
    it("takes the base itself and everything below it, without case", () => {
        expect(isDnWithin("ou=staff,dc=SADM,dc=test", "DC=sadm,DC=test")).toBe(true);
        expect(isDnWithin("DC=sadm,DC=test", "DC=sadm,DC=test")).toBe(true);
    });

    it("does not take a sibling or a name that only ends alike", () => {
        expect(isDnWithin("DC=other,DC=test", "DC=sadm,DC=test")).toBe(false);
        expect(isDnWithin("CN=x,DC=notsadm,DC=test", "DC=sadm,DC=test")).toBe(false);
        expect(isDnWithin("DC=test", "DC=sadm,DC=test")).toBe(false);
    });
});

describe("dnsNameOfDn", () => {
    it("is the domain's DNS name", () => {
        expect(dnsNameOfDn("DC=sadm,DC=test")).toBe("sadm.test");
        expect(dnsNameOfDn("CN=Users,DC=sadm,DC=test")).toBeNull();
    });
});

describe("parseServerDn", () => {
    const ntds = "CN=NTDS Settings,CN=DC1,CN=Servers,CN=Default-First-Site-Name,CN=Sites,CN=Configuration,DC=sadm,DC=test";

    it("names the domain controller and its site", () => {
        expect(parseServerDn(ntds)).toEqual({ name: "DC1", site: "Default-First-Site-Name" });
        expect(parseServerDn(ntds.replace("CN=NTDS Settings,", ""))).toEqual({
            name: "DC1",
            site: "Default-First-Site-Name",
        });
    });

    it("is nothing for another object", () => {
        expect(parseServerDn("CN=Users,DC=sadm,DC=test")).toBeNull();
    });
});
