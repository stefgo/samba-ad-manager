import type { DirectoryErrorCode } from "@sadm/shared";

/**
 * A refusal with its reason: why a question about the directory, or a change to it, got no
 * result. Anything else thrown on the way is a fault of this server, not an answer.
 */
export class DirectoryError extends Error {
    readonly code: DirectoryErrorCode;

    constructor(code: DirectoryErrorCode, message: string) {
        super(message);
        this.name = "DirectoryError";
        this.code = code;
    }
}

/** The HTTP status a refusal is answered with. */
export function directoryErrorStatus(err: DirectoryError): number {
    switch (err.code) {
        case "invalid":
            return 400;
        case "forbidden":
            return 403;
        case "not-found":
            return 404;
        case "conflict":
            return 409;
        case "unavailable":
            return 503;
        case "failed":
            return 502;
    }
}
