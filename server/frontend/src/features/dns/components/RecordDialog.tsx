import type { ReactNode } from "react";
import { Alert, Button, Input, Modal, Select, Textarea } from "@stefgo/react-ui-components";
import {
    CreateDnsRecordSchema,
    DNS_MANAGED_TYPES,
    UpdateDnsRecordSchema,
    type DnsManagedType,
    type DnsNode,
    type DnsRecord,
    type DnsZoneDetail,
} from "@sadm/shared";
import { useEntityForm, type EntityForm } from "../../../hooks/useEntityForm";
import { dnsApi } from "../../../queries/dns";
import { useDirectoryChange } from "../../../queries/directory";
import {
    RECORD_FIELDS,
    RECORD_TYPE_LABELS,
    createRecordInputFrom,
    recordDraftFrom,
    recordFieldOf,
    updateRecordInputFrom,
    type RecordDraft,
} from "../lib/recordForm";

const FORM_ID = "dns-record-form";

/** A field's label and what is typed into it, by the field. */
const FIELDS: Partial<Record<keyof RecordDraft, { label: string; hint?: string; numeric?: boolean }>> = {
    address: { label: "Address" },
    target: { label: "Target", hint: "The full name: www.example.net" },
    exchange: { label: "Mail Server", hint: "The full name: mail.example.net" },
    preference: { label: "Preference", hint: "The lower, the sooner it is tried.", numeric: true },
    priority: { label: "Priority", hint: "The lower, the sooner it is tried.", numeric: true },
    weight: { label: "Weight", hint: "Among targets of one priority: the share this one gets.", numeric: true },
    port: { label: "Port", numeric: true },
};

interface RecordFormProps {
    title: string;
    submitLabel: string;
    form: EntityForm<RecordDraft, unknown>;
    /** What stands above the type's own fields: the name of a new record. */
    children?: ReactNode;
    /** A record that exists keeps its type. */
    typeFixed: boolean;
    onClose: () => void;
    onSubmit: () => void;
}

/** The dialog both ways of entering a record share: the type, the fields that type has, the TTL. */
const RecordForm = ({ title, submitLabel, form, children, typeFixed, onClose, onSubmit }: RecordFormProps) => {
    const { draft } = form;
    return (
        <Modal
            isOpen
            onClose={onClose}
            title={title}
            closeOnOverlayClick={false}
            footer={
                <>
                    <Button type="button" variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" form={FORM_ID} variant="primary" disabled={!form.canSave} isLoading={form.isSaving}>
                        {submitLabel}
                    </Button>
                </>
            }
        >
            <form
                id={FORM_ID}
                className="space-y-4"
                onSubmit={(event) => {
                    event.preventDefault();
                    onSubmit();
                }}
            >
                {form.saveError && <Alert>{form.saveError}</Alert>}
                {form.formError && <Alert>{form.formError}</Alert>}

                {children}
                <Select
                    label="Type"
                    value={draft.type}
                    disabled={typeFixed}
                    onChange={(event) => form.set("type", event.target.value as DnsManagedType)}
                    options={DNS_MANAGED_TYPES.map((type) => ({ value: type, label: RECORD_TYPE_LABELS[type] }))}
                />

                {RECORD_FIELDS[draft.type].map((field, index) => {
                    if (field === "text") {
                        return (
                            <Textarea
                                key={field}
                                label="Text"
                                rows={4}
                                value={draft.text}
                                onChange={(event) => form.set("text", event.target.value)}
                                error={form.errors.text}
                                hint="One text per line, each at most 255 bytes. A longer value is split over several lines."
                            />
                        );
                    }
                    const about = FIELDS[field];
                    if (!about) return null;
                    return (
                        <Input
                            key={field}
                            label={about.label}
                            inputMode={about.numeric ? "numeric" : undefined}
                            value={draft[field]}
                            onChange={(event) => form.set(field, event.target.value)}
                            error={form.errors[field]}
                            hint={about.hint}
                            autoFocus={typeFixed && index === 0}
                        />
                    );
                })}

                <Input
                    label="TTL"
                    inputMode="numeric"
                    value={draft.ttl}
                    onChange={(event) => form.set("ttl", event.target.value)}
                    error={form.errors.ttl}
                    hint="Seconds a resolver may keep the answer."
                />
            </form>
        </Modal>
    );
};

interface NewRecordDialogProps {
    zone: DnsZoneDetail;
    onClose: () => void;
    /** Told the name the record was stored under, for the note that says so. */
    onSaved: (fqdn: string) => void;
}

/** Enters a record, under a name of the zone that may be new. */
export const NewRecordDialog = ({ zone, onClose, onSaved }: NewRecordDialogProps) => {
    const create = useDirectoryChange((draft: RecordDraft) => dnsApi.createRecord(zone.guid, createRecordInputFrom(draft)));
    const form = useEntityForm({
        initial: () => recordDraftFrom(null),
        schema: CreateDnsRecordSchema,
        toInput: createRecordInputFrom,
        fieldOf: recordFieldOf,
    });
    const name = form.draft.name.trim();

    return (
        <RecordForm
            title={`New Record in ${zone.name}`}
            submitLabel="Create"
            form={form}
            typeFixed={false}
            onClose={onClose}
            onSubmit={async () => {
                if (!(await form.submit(() => create.mutateAsync(form.draft)))) return;
                onSaved(`${name}.${zone.name}`);
                onClose();
            }}
        >
            <Input
                label="Name"
                value={form.draft.name}
                onChange={(event) => form.set("name", event.target.value)}
                error={form.errors.name}
                hint={name ? `${name}.${zone.name}` : `Within the zone: www for www.${zone.name}`}
                autoFocus
            />
        </RecordForm>
    );
};

interface EditRecordDialogProps {
    zone: DnsZoneDetail;
    node: DnsNode;
    record: DnsRecord;
    onClose: () => void;
    onSaved: (fqdn: string) => void;
}

/**
 * Changes what a record says, or its TTL. Its name and its type stay: under another name,
 * or of another type, it would be another record.
 */
export const EditRecordDialog = ({ zone, node, record, onClose, onSaved }: EditRecordDialogProps) => {
    const update = useDirectoryChange((draft: RecordDraft) =>
        dnsApi.updateRecord(zone.guid, node.guid, updateRecordInputFrom(draft, record.data)),
    );
    const form = useEntityForm({
        initial: () => recordDraftFrom(record, node.name),
        schema: UpdateDnsRecordSchema,
        toInput: (draft: RecordDraft) => updateRecordInputFrom(draft, record.data),
        fieldOf: recordFieldOf,
    });

    return (
        <RecordForm
            title={`Edit ${node.fqdn}`}
            submitLabel="Save"
            form={form}
            typeFixed
            onClose={onClose}
            onSubmit={async () => {
                if (!(await form.submit(() => update.mutateAsync(form.draft)))) return;
                onSaved(node.fqdn);
                onClose();
            }}
        />
    );
};
