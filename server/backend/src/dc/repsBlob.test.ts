import { describe, expect, it } from "vitest";
import { decodeRepsBlob } from "./repsBlob.js";
import { werrorText } from "./werror.js";

// Read off the head of DC=sadm,DC=test on a Samba 4.22 domain controller, over LDAPS.
const REPS_FROM =
    "AQAAAAAAAAAKAQAAAAAAALBo2yADAAAAsGjbIAMAAAAAAAAA0AAAADoAAABkAAAAERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERAAAAAOkPAAAAAAAAAAAAAAAAAADpDwAAAAAAAGSAKysehlpNsxmGfk+VEmVS/3SnyRvUSpohp0kzK0KSAAAAAAAAAAAAAAAAAAAAADYAAAAyYjJiODA2NC04NjFlLTRkNWEtYjMxOS04NjdlNGY5NTEyNjUuX21zZGNzLnNhZG0udGVzdAA=";
const REPS_TO =
    "AQAAAAAAAAAKAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0AAAADoAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGSAKysehlpNsxmGfk+VEmUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADYAAAAyYjJiODA2NC04NjFlLTRkNWEtYjMxOS04NjdlNGY5NTEyNjUuX21zZGNzLnNhZG0udGVzdAA=";

const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));

describe("decodeRepsBlob", () => {
    // What `ldbsearch --show-binary` printed for the same value.
    it("reads an inbound link as Samba itself prints it", () => {
        expect(decodeRepsBlob(bytes(REPS_FROM))).toEqual({
            partnerId: "2b2b8064-861e-4d5a-b319-867e4f951265",
            consecutiveFailures: 0,
            lastSuccess: "2026-10-11T00:26:24.000Z",
            lastAttempt: "2026-10-11T00:26:24.000Z",
            resultCode: 0,
        });
    });

    it("reads an outbound link, which names the partner and keeps no times", () => {
        expect(decodeRepsBlob(bytes(REPS_TO))).toEqual({
            partnerId: "2b2b8064-861e-4d5a-b319-867e4f951265",
            consecutiveFailures: 0,
            lastSuccess: null,
            lastAttempt: null,
            resultCode: 0,
        });
    });

    it("reads the failures and the error of a link that does not work", () => {
        const failing = bytes(REPS_FROM);
        const view = new DataView(failing.buffer);
        view.setUint32(12, 7, true);
        view.setUint32(32, 1722, true);
        expect(decodeRepsBlob(failing)).toMatchObject({ consecutiveFailures: 7, resultCode: 1722 });
    });

    it("reads version 2, which differs only behind what is read", () => {
        const v2 = bytes(REPS_FROM);
        new DataView(v2.buffer).setUint32(0, 2, true);
        expect(decodeRepsBlob(v2)?.partnerId).toBe("2b2b8064-861e-4d5a-b319-867e4f951265");
    });

    it("has no answer for a value that is cut short or of a version it does not know", () => {
        expect(decodeRepsBlob(bytes(REPS_FROM).subarray(0, 100))).toBeNull();
        const v9 = bytes(REPS_FROM);
        new DataView(v9.buffer).setUint32(0, 9, true);
        expect(decodeRepsBlob(v9)).toBeNull();
        expect(decodeRepsBlob(new Uint8Array(0))).toBeNull();
    });
});

describe("werrorText", () => {
    it("names the errors a link fails with, and says nothing for success", () => {
        expect(werrorText(0)).toBeNull();
        expect(werrorText(1722)).toBe("WERR_RPC_S_SERVER_UNAVAILABLE");
        expect(werrorText(8453)).toBe("WERR_DS_DRA_ACCESS_DENIED");
    });

    it("leaves a code it does not know a number", () => {
        expect(werrorText(4711)).toBe("Windows error 4711");
    });
});
