import type { ZodError } from "zod";

/**
 * Turns a Zod failure into the one sentence that goes into `{ error: … }`.
 *
 * `error.issues[0].message` alone reads as "Invalid input: expected string, received
 * undefined" and leaves the caller to guess which field it meant. Prefixing the path makes
 * it actionable; where there is no path -- a body of the wrong type altogether -- the
 * message stands alone.
 *
 * Only the first issue: a reply carries a single `error` string, and a caller fixing one
 * field at a time gets the next one on the next attempt.
 */
export function firstIssue(error: ZodError): string {
    const issue = error.issues[0];
    if (!issue) return "Invalid request";
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
}
