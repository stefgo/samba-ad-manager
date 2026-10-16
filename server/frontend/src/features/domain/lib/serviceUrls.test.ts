import { describe, expect, it } from "vitest";
import { buildDomainHealth, type ServiceUrlHealth } from "@sadm/shared";
import { certificateLeft, serviceUrlRows } from "./serviceUrls";

const NOW = Date.parse("2026-10-17T12:00:00.000Z");
const inDays = (days: number) => new Date(NOW + days * 86_400_000).toISOString();
const DC1 = { id: "11111111-1111-4111-8111-111111111111", name: "DC1" };

const url = (over: Partial<ServiceUrlHealth> = {}): ServiceUrlHealth => ({
    url: "ldaps://ldap.example.net",
    scheme: "ldaps",
    host: "ldap.example.net",
    port: 636,
    collectedAt: inDays(0),
    ok: true,
    answeredBy: "DC1",
    tls: {
        ok: true,
        certificate: { subject: "ldap.example.net", issuer: "R10", names: ["ldap.example.net"], validFrom: inDays(-60), validTo: inDays(30) },
    },
    ...over,
});

/** The rows for these URLs, judged by the same function the findings come from. */
const rows = (...urls: ServiceUrlHealth[]) => serviceUrlRows(buildDomainHealth([DC1], {}, { now: NOW }, [], urls));

describe("serviceUrlRows", () => {
    it("lists a URL that answers with a good certificate, with the domain controller behind it", () => {
        expect(rows(url())).toEqual([
            {
                url: "ldaps://ldap.example.net",
                state: "ok",
                tone: "success",
                answeredBy: "DC1",
                dcId: DC1.id,
                detail: null,
                validTo: inDays(30),
            },
        ]);
    });

    it("names a domain controller the directory does not list as it answered, without a link", () => {
        const [row] = rows(url({ answeredBy: "DC9" }));
        expect(row.answeredBy).toBe("DC9");
        expect(row.dcId).toBeUndefined();
    });

    it("says that one does not answer, and why", () => {
        expect(rows(url({ ok: false, detail: "timed out", answeredBy: null, tls: null }))[0]).toMatchObject({
            state: "down",
            tone: "error",
            detail: "timed out",
            validTo: null,
        });
    });

    it("says why a certificate is not good for the URL", () => {
        const bad = url({ tls: { ok: false, detail: "it is issued for dc1.home.lan" } });
        expect(rows(bad)[0]).toMatchObject({ state: "certificate", tone: "error", detail: "it is issued for dc1.home.lan" });
    });

    it("follows the finding's severity for a certificate that expires", () => {
        const expiring = (days: number) =>
            url({ tls: { ok: true, certificate: { names: [], validFrom: inDays(-60), validTo: inDays(days) } } });
        expect(rows(expiring(10))[0]).toMatchObject({ state: "expiring", tone: "warning" });
        expect(rows(expiring(1))[0]).toMatchObject({ state: "expiring", tone: "error" });
    });

    it("tells two URLs on one name apart", () => {
        const plain = url({ url: "ldap://ldap.example.net", scheme: "ldap", port: 389, tls: { ok: false, detail: "StartTLS refused" } });
        expect(rows(url(), plain).map((row) => [row.url, row.state])).toEqual([
            ["ldap://ldap.example.net", "certificate"],
            ["ldaps://ldap.example.net", "ok"],
        ]);
    });
});

describe("certificateLeft", () => {
    it("says how long a certificate has left, or that it has expired", () => {
        expect(certificateLeft(inDays(30), NOW)).toBe("30 d left");
        expect(certificateLeft(inDays(-1), NOW)).toBe("expired");
        expect(certificateLeft("not a date", NOW)).toBe("");
    });
});
