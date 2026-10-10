import { describe, expect, it } from "vitest";
import {
    EMPTY_VALUE,
    clientName,
    describeFailure,
    formatDate,
    formatRelative,
    formatTime,
    getErrorMessage,
    plural,
} from "./utils";

// Noon UTC is the same calendar day in every zone the tests may run in.
const date = "2026-10-03T12:00:30Z";
const de = { locale: "de-DE" };

describe("formatDate", () => {
    it("writes day, month, year and the time without seconds", () => {
        expect(formatDate(date, de)).toMatch(/^03\.10\.2026, \d{2}:\d{2}$/);
    });

    it("adds the seconds where asked", () => {
        expect(formatDate(date, { ...de, seconds: true })).toMatch(/^03\.10\.2026, \d{2}:\d{2}:30$/);
    });

    it("writes it the way the locale does", () => {
        expect(formatDate(date, { locale: "en-US" })).toMatch(/^10\/03\/2026, \d{2}:\d{2}\s[AP]M$/);
    });

    it("takes a Date and a timestamp as well", () => {
        expect(formatDate(new Date(date))).toBe(formatDate(date));
        expect(formatDate(Date.parse(date))).toBe(formatDate(date));
    });

    it("reads SQLite's format as UTC", () => {
        expect(formatDate("2026-10-03 12:00:30", { seconds: true })).toBe(formatDate(date, { seconds: true }));
    });

    it("shows the empty value when there is no date, or none that parses", () => {
        expect(formatDate(null)).toBe(EMPTY_VALUE);
        expect(formatDate(undefined)).toBe(EMPTY_VALUE);
        expect(formatDate("")).toBe(EMPTY_VALUE);
        expect(formatDate("yesterday")).toBe(EMPTY_VALUE);
    });
});

describe("formatRelative", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    const ago = (ms: number) => formatRelative(now - ms, now, "en-US");
    const min = 60_000;
    const h = 60 * min;
    const d = 24 * h;

    it("calls the last minute now", () => {
        expect(ago(0)).toBe("just now");
        expect(ago(59_000)).toBe("just now");
    });

    it("counts minutes, hours and days, each rounded down", () => {
        expect(ago(min)).toBe("1 min ago");
        expect(ago(59 * min)).toBe("59 min ago");
        expect(ago(h)).toBe("1 h ago");
        expect(ago(23 * h + 59 * min)).toBe("23 h ago");
        expect(ago(d)).toBe("1 d ago");
        expect(ago(30 * d)).toBe("30 d ago");
    });

    it("writes the date once the distance says nothing any more", () => {
        expect(ago(31 * d)).toBe(formatDate(now - 31 * d, { locale: "en-US" }));
    });

    it("does not turn a clock that runs a little ahead into a date", () => {
        expect(ago(-30_000)).toBe("just now");
    });

    it("writes a date that lies ahead as the date", () => {
        expect(ago(-h)).toBe(formatDate(now + h, { locale: "en-US" }));
    });

    it("reads SQLite's format and has nothing to say without a date", () => {
        expect(formatRelative("2026-10-04 10:00:00", now)).toBe("2 h ago");
        expect(formatRelative(null, now)).toBe(EMPTY_VALUE);
    });
});

describe("formatTime", () => {
    it("writes the time of day alone, with seconds", () => {
        expect(formatTime(date, "de-DE")).toMatch(/^\d{2}:\d{2}:30$/);
    });

    it("agrees with the time formatDate writes", () => {
        expect(formatDate(date, { ...de, seconds: true }).endsWith(formatTime(date, "de-DE"))).toBe(true);
        expect(formatTime("2026-10-03 12:00:30")).toBe(formatTime(date));
    });

    it("shows the empty value when there is no date", () => {
        expect(formatTime(null)).toBe(EMPTY_VALUE);
        expect(formatTime("yesterday")).toBe(EMPTY_VALUE);
    });
});

describe("plural", () => {
    it("adds an s for anything but one", () => {
        expect(plural(1, "host")).toBe("1 host");
        expect(plural(0, "host")).toBe("0 hosts");
        expect(plural(3, "host")).toBe("3 hosts");
    });

    it("takes the plural of a noun that has no plain one", () => {
        expect(plural(1, "address", "addresses")).toBe("1 address");
        expect(plural(2, "address", "addresses")).toBe("2 addresses");
    });
});

describe("clientName", () => {
    it("is the display name, or the hostname while there is none", () => {
        expect(clientName({ displayName: "dc1", hostname: "dc1.example.net" })).toBe("dc1");
        expect(clientName({ displayName: null, hostname: "dc1.example.net" })).toBe("dc1.example.net");
        expect(clientName({ hostname: "dc1.example.net" })).toBe("dc1.example.net");
    });

    // `||`, not `??`: a row must never show no name at all.
    it("falls back for an empty display name as well", () => {
        expect(clientName({ displayName: "", hostname: "dc1.example.net" })).toBe("dc1.example.net");
    });
});

describe("getErrorMessage", () => {
    it("is the message of an Error and a string as it is", () => {
        expect(getErrorMessage(new Error("no route to host"))).toBe("no route to host");
        expect(getErrorMessage("no route to host")).toBe("no route to host");
    });

    it("writes anything else as JSON", () => {
        expect(getErrorMessage({ code: 502 })).toBe('{"code":502}');
        expect(getErrorMessage(null)).toBe("null");
    });

    it("still answers for what cannot be written as JSON", () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(getErrorMessage(circular)).toBe("[object Object]");
    });
});

describe("describeFailure", () => {
    it("says what did not happen, and the server's reason why", () => {
        expect(describeFailure("Could not delete the client", new Error("Client is online"))).toEqual({
            title: "Could not delete the client",
            description: "Client is online",
        });
    });
});
