import { useLocation, useNavigate } from "react-router-dom";
import type { Webhook } from "@sadm/shared";
import { useConfirm } from "@stefgo/react-ui-components";
import { useQueryClient } from "@tanstack/react-query";
import { describeDeleteWebhook } from "../confirmations";
import { QueryError } from "../../../components/QueryError";
import { ROUTES, paths } from "../../../lib/paths";
import { useDeleteWebhook, useSaveWebhook, useWebhooks, webhookListOptions } from "../../../queries/webhooks";
import { WebhookList } from "./WebhookList";

/** The page at `/webhooks`. Adding and editing happen on pages of their own. */
export const WebhookOverview = () => {
    const navigate = useNavigate();
    const { search } = useLocation();
    const { confirm } = useConfirm();
    const queryClient = useQueryClient();
    /** Only the first load shows as loading; a reload keeps the rows on screen. */
    const { webhooks, isPending, error } = useWebhooks();
    const saveWebhook = useSaveWebhook();
    const deleteWebhook = useDeleteWebhook();

    // The editor closes onto this list, and takes the list's search along to bring it back.
    const open = (pathname: string) => navigate({ pathname, search });

    const requestDelete = (webhook: Webhook) =>
        confirm({
            ...describeDeleteWebhook(webhook.name),
            onConfirm: () => deleteWebhook.mutateAsync(webhook.id),
        });

    // The switch moves at once; the reload afterwards shows what the server holds, which puts
    // it back if the change was refused. PUT takes the whole webhook, so the row is sent as is.
    const toggleEnabled = (webhook: Webhook, enabled: boolean) => {
        queryClient.setQueryData(webhookListOptions.queryKey, (list) =>
            list?.map((w) => (w.id === webhook.id ? { ...w, enabled } : w)),
        );
        saveWebhook.mutate({ id: webhook.id, input: { ...webhook, enabled } }, { onError: (e) => console.error(e) });
    };

    if (error) return <QueryError title="Could not load the webhooks" error={error} />;

    return (
        <div className="space-y-6">
            <WebhookList
                webhooks={webhooks}
                isLoading={isPending}
                onAdd={() => open(ROUTES.webhookNew)}
                onEdit={(webhook) => open(paths.webhook(webhook.id))}
                onDelete={requestDelete}
                onToggleEnabled={toggleEnabled}
            />
        </div>
    );
};
