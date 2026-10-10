import type { To } from "react-router-dom";

export type NotFoundSubject = "client" | "webhook" | "user" | "group" | "computer";

/**
 * Thrown while rendering by a route whose subject does not exist -- only once the list it
 * would be in has answered. The route tree's `errorElement` turns it into the not-found
 * card, and the URL stays where it was.
 *
 * Thrown in render rather than in a `loader`: the lists live in the query cache and are
 * kept current by the socket, so a client deleted while its page is open is noticed too.
 *
 * Only for a subject that is gone for good once it is missing. The router keeps the error
 * element until the next navigation, so a subject that may be back with the next reading
 * has its page say "not found" itself.
 */
export class NotFoundError extends Error {
    readonly subject: NotFoundSubject;
    /** Where the card's button leads, when the subject's own list is not the right place. */
    readonly backTo?: To;

    constructor(subject: NotFoundSubject, backTo?: To) {
        super(`${subject} not found`);
        this.name = "NotFoundError";
        this.subject = subject;
        this.backTo = backTo;
    }
}
