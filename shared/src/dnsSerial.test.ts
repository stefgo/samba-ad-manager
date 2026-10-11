import { describe, expect, it } from "vitest";
import { compareSerial, highestSerial, nextSerial } from "./dnsSerial.js";

describe("compareSerial", () => {
    it("orders two numbers that are close as one would expect", () => {
        expect(compareSerial(5, 6)).toBeLessThan(0);
        expect(compareSerial(6, 5)).toBeGreaterThan(0);
        expect(compareSerial(6, 6)).toBe(0);
    });

    it("counts across the wrap-around", () => {
        expect(compareSerial(4294967295, 1)).toBeLessThan(0);
        expect(compareSerial(1, 4294967295)).toBeGreaterThan(0);
    });

    it("reads a number more than half the circle away as behind", () => {
        expect(compareSerial(3000000000, 10)).toBeLessThan(0);
        expect(compareSerial(10, 3000000000)).toBeGreaterThan(0);
    });

    it("calls a number half the circle away ahead, either way round", () => {
        expect(compareSerial(0, 2147483648)).toBeGreaterThan(0);
        expect(compareSerial(2147483648, 0)).toBeGreaterThan(0);
    });
});

describe("highestSerial", () => {
    it("picks the highest", () => {
        expect(highestSerial([5, 9, 7])).toBe(9);
        expect(highestSerial([4294967295, 2])).toBe(2);
    });

    it("has nothing to pick from an empty list", () => {
        expect(highestSerial([])).toBeNull();
    });
});

describe("nextSerial", () => {
    it("counts up", () => {
        expect(nextSerial(41)).toBe(42);
    });

    it("wraps around past zero", () => {
        expect(nextSerial(4294967295)).toBe(1);
        expect(nextSerial(4294967294)).toBe(4294967295);
    });
});
