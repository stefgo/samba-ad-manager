import type { z } from "zod";
import { apiFetch } from "./apiFetch";

/**
 * The one place a response body is read.
 *
 * Every call names the schema its answer has to match, and gets back what that schema
 * parsed -- never the `any` of `res.json()`. Before this, every call site read the body
 * itself and asserted a type, and found out in a component, as `undefined`, when the
 * server sent something else. Some did not look at the status either, so a list that
 * could not be read reached the user as an empty one.
 *
 * A call that expects no body passes no schema and gets `void`.
 */

/** A request the server refused, or an answer that is not what the contract says. */
export class ApiError extends Error {
    /** The HTTP status; a caller may branch on it (a 404 that is an ordinary state). */
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}

export interface RequestOptions {
    /** What the error says when the server's answer carries no `error` text of its own. */
    fallback?: string;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * The server's own `error` text when the body carries one, `fallback` otherwise. Callers
 * used to throw a fixed "Failed to ..." and drop the body, so a refusal the server had
 * explained ("the directory is read-only") reached the user as a guess.
 */
async function refusal(res: Response, method: Method, path: string, fallback?: string): Promise<ApiError> {
    const body: unknown = await res.json().catch(() => null);
    const text =
        typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
            ? body.error
            : "";
    return new ApiError(
        text || fallback || res.statusText || `${method} ${path} failed (HTTP ${res.status})`,
        res.status,
    );
}

async function request<T>(
    fetcher: Fetcher,
    method: Method,
    path: string,
    body: unknown,
    schema: z.ZodType<T> | undefined,
    options: RequestOptions | undefined,
): Promise<T | void> {
    const init: RequestInit = { method };
    if (body !== undefined) {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(body);
    }

    const res = await fetcher(path, init);
    if (!res.ok) throw await refusal(res, method, path, options?.fallback);
    if (!schema) return;

    // A body that is not JSON at all fails the schema like any other wrong shape.
    const data: unknown = await res.json().catch(() => undefined);
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
        // The issues go to the console, not to the user: they name fields, which helps
        // whoever debugs it and nobody who is looking at a list.
        console.error(`Unexpected response from ${method} ${path}:`, parsed.error.issues);
        throw new ApiError(`Unexpected response from ${method} ${path}`, res.status);
    }
    return parsed.data;
}

function createClient(fetcher: Fetcher) {
    function get<T>(path: string, schema: z.ZodType<T>, options?: RequestOptions): Promise<T>;
    function get<T>(path: string, schema: z.ZodType<T>, options?: RequestOptions) {
        return request(fetcher, "GET", path, undefined, schema, options);
    }

    function post(path: string, body?: unknown, schema?: undefined, options?: RequestOptions): Promise<void>;
    function post<T>(path: string, body: unknown, schema: z.ZodType<T>, options?: RequestOptions): Promise<T>;
    function post<T>(path: string, body?: unknown, schema?: z.ZodType<T>, options?: RequestOptions) {
        return request(fetcher, "POST", path, body, schema, options);
    }

    function put(path: string, body?: unknown, schema?: undefined, options?: RequestOptions): Promise<void>;
    function put<T>(path: string, body: unknown, schema: z.ZodType<T>, options?: RequestOptions): Promise<T>;
    function put<T>(path: string, body?: unknown, schema?: z.ZodType<T>, options?: RequestOptions) {
        return request(fetcher, "PUT", path, body, schema, options);
    }

    function patch(path: string, body?: unknown, schema?: undefined, options?: RequestOptions): Promise<void>;
    function patch<T>(path: string, body: unknown, schema: z.ZodType<T>, options?: RequestOptions): Promise<T>;
    function patch<T>(path: string, body?: unknown, schema?: z.ZodType<T>, options?: RequestOptions) {
        return request(fetcher, "PATCH", path, body, schema, options);
    }

    function del(path: string, options?: RequestOptions): Promise<void>;
    function del(path: string, options?: RequestOptions) {
        return request(fetcher, "DELETE", path, undefined, undefined, options);
    }

    return { get, post, put, patch, delete: del };
}

/**
 * Every endpoint behind the session. A 401 logs out centrally (see `apiFetch`) and
 * surfaces here as `SessionExpiredError`, which is passed through untouched.
 */
export const api = createClient(apiFetch);

/**
 * The unauthenticated endpoints: login, logout and `/api/auth/config`. Plain `fetch`,
 * deliberately -- routed through `apiFetch`, a wrong password would log the user out
 * and redirect instead of showing "Login failed". Here a 401 is an `ApiError` like any
 * other refusal.
 */
export const publicApi = createClient((input, init) =>
    // The login's value is its Set-Cookie header, which is only stored when the request
    // opts into credentials.
    fetch(input, { ...init, credentials: "same-origin" }),
);
