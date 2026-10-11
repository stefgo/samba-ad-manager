import {
    DEFAULT_DNS_TTL,
    type CreateDnsRecord,
    type DnsManagedType,
    type DnsRecord,
    type DnsRecordInput,
    type UpdateDnsRecord,
} from "@sadm/shared";
import type { FieldOf } from "../../../lib/entityForm";

/**
 * The fields of the record dialog, as typed. One form for every type and for a new record
 * as for a change: which fields show is the type's, and a field that does not show is not
 * part of what is sent.
 */
export interface RecordDraft {
    /** The name within the zone. Fixed once the record exists. */
    name: string;
    type: DnsManagedType;
    /** A, AAAA */
    address: string;
    /** CNAME, PTR, SRV */
    target: string;
    /** MX */
    exchange: string;
    preference: string;
    /** SRV */
    priority: string;
    weight: string;
    port: string;
    /** TXT: one text per line. */
    text: string;
    ttl: string;
}

const EMPTY: Omit<RecordDraft, "name" | "type" | "ttl"> = {
    address: "",
    target: "",
    exchange: "",
    preference: "10",
    priority: "0",
    weight: "100",
    port: "",
    text: "",
};

/** The draft a dialog opens with: empty for a new record, what the record says for a change. */
export function recordDraftFrom(record: DnsRecord | null, name = "", type: DnsManagedType = "A"): RecordDraft {
    if (!record) return { ...EMPTY, name, type, ttl: String(DEFAULT_DNS_TTL) };
    const { data } = record;
    const draft: RecordDraft = { ...EMPTY, name, type, ttl: String(record.ttl) };
    switch (data.type) {
        case "A":
        case "AAAA":
            return { ...draft, type: data.type, address: data.address };
        case "CNAME":
        case "PTR":
            return { ...draft, type: data.type, target: data.target };
        case "TXT":
            return { ...draft, type: "TXT", text: data.strings.join("\n") };
        case "MX":
            return { ...draft, type: "MX", preference: String(data.preference), exchange: data.exchange };
        case "SRV":
            return {
                ...draft,
                type: "SRV",
                priority: String(data.priority),
                weight: String(data.weight),
                port: String(data.port),
                target: data.target,
            };
        default:
            // A type that is not entered here has no dialog; this is never shown.
            return draft;
    }
}

/** A number as typed. What is none arrives as NaN, which the schema names at the field. */
const number = (text: string): number => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

/** What the record says, from the fields its type shows. */
export function recordInputFrom(draft: RecordDraft): DnsRecordInput {
    switch (draft.type) {
        case "A":
        case "AAAA":
            return { type: draft.type, address: draft.address.trim() };
        case "CNAME":
        case "PTR":
            return { type: draft.type, target: draft.target };
        case "TXT":
            // An empty line is no text of the record; a line that is only spaces is one.
            return { type: "TXT", strings: draft.text.split("\n").filter((line) => line !== "") };
        case "MX":
            return { type: "MX", preference: number(draft.preference), exchange: draft.exchange };
        case "SRV":
            return {
                type: "SRV",
                priority: number(draft.priority),
                weight: number(draft.weight),
                port: number(draft.port),
                target: draft.target,
            };
    }
}

export const createRecordInputFrom = (draft: RecordDraft): CreateDnsRecord => ({
    name: draft.name,
    record: recordInputFrom(draft),
    ttl: number(draft.ttl),
});

export const updateRecordInputFrom = (draft: RecordDraft, old: DnsRecord["data"]): UpdateDnsRecord => ({
    old,
    record: recordInputFrom(draft),
    ttl: number(draft.ttl),
});

/** Where an issue of the request is shown: at the field the value was typed into. */
export const recordFieldOf: FieldOf<RecordDraft> = (path) => {
    const [head, field] = path;
    if (head === "name" || head === "ttl") return head;
    if (head !== "record") return null;
    switch (field) {
        case "address":
        case "target":
        case "exchange":
        case "preference":
        case "priority":
        case "weight":
        case "port":
            return field;
        case "strings":
            return "text";
        default:
            return null;
    }
};

/** The fields a type shows, in the order they are typed in. */
export const RECORD_FIELDS: Record<DnsManagedType, readonly (keyof RecordDraft)[]> = {
    A: ["address"],
    AAAA: ["address"],
    CNAME: ["target"],
    PTR: ["target"],
    TXT: ["text"],
    MX: ["preference", "exchange"],
    SRV: ["priority", "weight", "port", "target"],
};

/** What each type is for, in the type picker. */
export const RECORD_TYPE_LABELS: Record<DnsManagedType, string> = {
    A: "A — IPv4 address",
    AAAA: "AAAA — IPv6 address",
    CNAME: "CNAME — alias for another name",
    PTR: "PTR — name of an address",
    TXT: "TXT — text",
    MX: "MX — mail server",
    SRV: "SRV — service",
};
