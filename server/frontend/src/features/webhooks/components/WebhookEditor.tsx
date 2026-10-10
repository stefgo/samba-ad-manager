import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Send, Webhook as WebhookIcon, X } from "lucide-react";
import {
    ACTIVITY_LEVELS,
    WEBHOOK_METHODS,
    WebhookInputSchema,
    type Webhook,
    type WebhookTestResult,
} from "@sadm/shared";
import {
    ActionButton,
    Button,
    Card,
    Input,
    Select,
    Switch,
    Textarea,
    LoadingIndicator,
    Alert,
    FieldLabel,
} from "@stefgo/react-ui-components";
import { testWebhook, useSaveWebhook, useWebhooks } from "../../../queries/webhooks";
import { getErrorMessage } from "../../../utils";
import { QueryError } from "../../../components/QueryError";
import { useEntityForm } from "../../../hooks/useEntityForm";
import { useUnsavedChangesGuard } from "../../../hooks/useUnsavedChangesGuard";
import { NotFoundError } from "../../../lib/notFound";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import {
    EMPTY_DRAFT,
    PLACEHOLDERS,
    draftFrom,
    inputFrom,
    previewBody,
    webhookFieldOf,
    webhookRules,
    type WebhookDraft,
} from "../lib/webhookForm";

/**
 * `/webhooks/new` and `/webhooks/:webhookId`. The webhook is read from the list --
 * there is no single-item endpoint, and the list is short. A link to an id that is gone gets the
 * not-found card of the route tree instead of an empty form.
 */
export const WebhookEditorRoute = () => {
    const { webhookId } = useParams();
    const { webhooks, isPending, error } = useWebhooks();
    const webhook = webhooks.find((w) => w.id === webhookId);

    if (!webhookId) return <WebhookEditor webhook={null} />;
    // Not "not found": without the list nothing says whether the webhook exists.
    if (!webhook && error) return <QueryError title="Could not load the webhook" error={error} />;
    if (!webhook && isPending) return <LoadingIndicator label="Loading webhook…" />;
    if (!webhook) throw new NotFoundError("webhook");
    // Keyed, so pointing the route at another webhook starts the form over.
    return <WebhookEditor key={webhook.id} webhook={webhook} />;
};

/**
 * Adds or edits one webhook, on a page of its own. Leaving is a navigation and asks first
 * when there are unsaved edits, whichever way out is taken (`useUnsavedChangesGuard`). It
 * leads to the list, the editor's parent in the route tree.
 *
 * Save is off until the draft is one the server takes, and each field says what it lacks:
 * the draft is checked against `WebhookInputSchema`, the schema the request is parsed with.
 *
 * The form holds a copy: the `webhook` prop may be refreshed by a dashboard message while
 * it is open -- a delivery that went out -- and what is typed must not follow it.
 */
const WebhookEditor = ({ webhook }: { webhook: Webhook | null }) => {
    const { mutateAsync: saveWebhook } = useSaveWebhook();

    const form = useEntityForm({
        schema: WebhookInputSchema,
        initial: () => (webhook ? draftFrom(webhook) : EMPTY_DRAFT),
        toInput: inputFrom,
        fieldOf: webhookFieldOf,
        rules: webhookRules,
    });
    const { draft, set, errors, isSaving } = form;
    const { close, leave } = useUnsavedChangesGuard(form.isDirty, "webhook");

    const [testError, setTestError] = useState<string | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<WebhookTestResult | null>(null);

    const preview = useMemo(
        () => previewBody(draft.bodyTemplate, draft.name || "webhook", draft.kinds),
        [draft.bodyTemplate, draft.name, draft.kinds],
    );

    // A saved webhook has nothing left to do here; the list shows it.
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setTestError(null);
        if (await form.submit((input) => saveWebhook({ id: webhook?.id, input }))) leave();
    };

    const handleTest = async () => {
        setIsTesting(true);
        setTestError(null);
        setTestResult(null);
        try {
            setTestResult(await testWebhook(inputFrom(draft)));
        } catch (err: unknown) {
            setTestError(getErrorMessage(err));
        } finally {
            setIsTesting(false);
        }
    };

    // Only what belongs to no field: what a field lacks is said at the field.
    const error = form.saveError ?? form.formError ?? testError;

    const heading = webhook ? `Edit ${webhook.name}` : "Add Webhook";

    return (
        <Card
            title={
                <>
                    <WebhookIcon size={18} className="text-text-muted" />
                    <HeaderBreadcrumb current={heading}>{heading}</HeaderBreadcrumb>
                </>
            }
            action={<ActionButton icon={X} tooltip="Close" onClick={close} />}
            padding="none"
        >
            <form onSubmit={handleSubmit} className="space-y-4 p-6">
                {error && <Alert>{error}</Alert>}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                        label="Name"
                        value={draft.name}
                        onChange={(e) => set("name", e.target.value)}
                        placeholder="Ops channel"
                        error={errors.name}
                    />
                    {/* Switch only lays its label out inline; this one is stacked like the other fields. */}
                    <div>
                        <FieldLabel htmlFor="webhook-enabled">Enabled</FieldLabel>
                        <div className="flex h-[42px] items-center">
                            <Switch
                                id="webhook-enabled"
                                value={draft.enabled}
                                onChange={(enabled) => set("enabled", enabled)}
                            />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[8rem_1fr_12rem] gap-4">
                    <Select
                        label="Method"
                        value={draft.method}
                        onChange={(e) => set("method", e.target.value as WebhookDraft["method"])}
                        options={WEBHOOK_METHODS.map((method) => ({ value: method, label: method }))}
                    />
                    <Input
                        label="URL"
                        value={draft.url}
                        onChange={(e) => set("url", e.target.value)}
                        placeholder="https://hooks.example.com/…"
                        error={errors.url}
                        hint="Placeholders are allowed here too, and inserted as text."
                    />
                    <Input
                        label="Timeout (Seconds)"
                        type="number"
                        min="1"
                        max="60"
                        value={draft.timeoutSeconds}
                        onChange={(e) => set("timeoutSeconds", e.target.value)}
                        error={errors.timeoutSeconds}
                        hint="Per attempt, 1–60. A timeout is retried up to twice."
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[8rem_1fr] gap-4">
                    <Select
                        label="Minimum Level"
                        value={draft.minLevel}
                        onChange={(e) => set("minLevel", e.target.value as WebhookDraft["minLevel"])}
                        options={ACTIVITY_LEVELS.map((level) => ({ value: level, label: level }))}
                        hint="Events below this level are not sent."
                    />
                    <Input
                        label="Event Kinds"
                        value={draft.kinds}
                        onChange={(e) => set("kinds", e.target.value)}
                        placeholder="all kinds"
                        error={errors.kinds}
                        hint="Comma separated, * as wildcard: client.*, scheduler.failed"
                    />
                </div>

                <Textarea
                    label="Headers"
                    rows={3}
                    value={draft.headers}
                    onChange={(e) => set("headers", e.target.value)}
                    placeholder="Authorization: Bearer …"
                    error={errors.headers}
                    hint="One Name: value per line. Content-Type: application/json is always sent."
                    classNames={{ textarea: "font-mono text-xs" }}
                />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Textarea
                        label="Body Template (JSON)"
                        rows={16}
                        value={draft.bodyTemplate}
                        onChange={(e) => set("bodyTemplate", e.target.value)}
                        error={errors.bodyTemplate ?? preview.error}
                        spellCheck={false}
                        classNames={{ textarea: "font-mono text-xs sm:text-xs" }}
                    />
                    {/* basis-0 keeps the preview out of the row's height, so the textarea alone sets it */}
                    <div className="flex flex-col">
                        <label className="field-label">
                            Preview (sample <span className="font-mono">{preview.kind}</span>)
                        </label>
                        <pre className="mt-1 flex-1 basis-0 min-h-40 lg:min-h-0 overflow-auto rounded-lg border border-border bg-app-bg p-3 text-xs font-mono text-text-primary">
                            {preview.body ?? "–"}
                        </pre>
                    </div>
                </div>

                <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-text-primary">
                        Available placeholders
                    </summary>
                    <p className="mt-2 text-xs text-text-muted">
                        A string that is only a placeholder, such as <code>"{"{{event.data}}"}"</code>,
                        becomes the value with its type. Inside longer text it is inserted as text.{" "}
                        <code>{'{{client.name | default("server")}}'}</code> stands in for a missing value;
                        <code> event.data.from</code> reaches into an object.
                    </p>
                    <dl className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                        {PLACEHOLDERS.map((p) => (
                            <div key={p.path} className="flex gap-2">
                                <dt className="font-mono text-text-primary shrink-0">{`{{${p.path}}}`}</dt>
                                <dd className="text-text-muted truncate">{p.description}</dd>
                            </div>
                        ))}
                    </dl>
                    <p className="mt-3 text-xs text-text-muted">
                        <span className="font-medium text-text-primary">Filters</span> follow the path and chain:{" "}
                        <code>{"{{client.name | default(\"server\") | upper}}"}</code>. There are{" "}
                        <code>default</code>, <code>join</code>, <code>map</code>, <code>truncate</code>,{" "}
                        <code>upper</code> and <code>lower</code>.
                    </p>
                    <p className="mt-2 text-xs text-text-muted">
                        <span className="font-medium text-text-primary">Conditions and loops</span> are objects:{" "}
                        <code>{'{"$if": "event.data.error", "then": …, "else": …}'}</code>,{" "}
                        <code>{'{"$map": "event.data.members", "each(m)": "{{m.host}}"}'}</code> and{" "}
                        <code>{'{"$join": …, "with": "\\n"}'}</code>. The preview renders the sample of the
                        first matching event kind.{" "}
                        <a
                            href="https://stefgo.github.io/samba-ad-manager/webhooks/#conditions-and-loops"
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                        >
                            Reference
                        </a>
                    </p>
                </details>

                {testResult && (
                    <Alert
                        tone={testResult.ok ? "success" : "error"}
                        title={testResult.ok ? `Delivered (HTTP ${testResult.status})` : `Failed: ${testResult.error}`}
                    >
                        {testResult.response && (
                            <pre className="whitespace-pre-wrap break-all text-xs font-mono opacity-80">
                                {testResult.response}
                            </pre>
                        )}
                    </Alert>
                )}

                <div className="flex justify-between gap-3 pt-4 border-t border-border">
                    <Button
                        type="button"
                        variant="secondary"
                        icon={Send}
                        onClick={handleTest}
                        isLoading={isTesting}
                        disabled={isTesting || isSaving || !form.isValid}
                    >
                        Send Test
                    </Button>
                    <div className="flex gap-3">
                        <Button type="button" variant="secondary" onClick={close}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="primary" isLoading={isSaving} disabled={!form.canSave}>
                            Save
                        </Button>
                    </div>
                </div>
            </form>
        </Card>
    );
};
