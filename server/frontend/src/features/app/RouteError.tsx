import { useRouteError, type To } from "react-router-dom";
import { Card } from "@stefgo/react-ui-components";
import { NotFoundCard } from "../../components/NotFoundCard";
import { NotFoundError, type NotFoundSubject } from "../../lib/notFound";
import { ROUTES } from "../../lib/paths";
import { getErrorMessage } from "../../utils";

/** What the card says for each subject, and the list its button leads back to. */
const NOT_FOUND: Record<NotFoundSubject, { title: string; text: string; backTo: To; backLabel: string }> = {
    domainController: {
        title: "Domain controller not found",
        text: "The directory lists no domain controller with this id. It may have been demoted.",
        backTo: ROUTES.domainControllers,
        backLabel: "Back to domain controllers",
    },
    user: {
        title: "User not found",
        text: "The directory has no user with this id. It may have been deleted.",
        backTo: ROUTES.directoryUsers,
        backLabel: "Back to users",
    },
    group: {
        title: "Group not found",
        text: "The directory has no group with this id. It may have been deleted.",
        backTo: ROUTES.directoryGroups,
        backLabel: "Back to groups",
    },
    computer: {
        title: "Computer not found",
        text: "The directory has no computer with this id. It may have been deleted.",
        backTo: ROUTES.directoryComputers,
        backLabel: "Back to computers",
    },
    zone: {
        title: "Zone not found",
        text: "The directory has no DNS zone with this id. It may have been deleted.",
        backTo: ROUTES.dnsZones,
        backLabel: "Back to DNS zones",
    },
    webhook: {
        title: "Webhook not found",
        text: "There is no webhook with this id. It may have been deleted.",
        backTo: ROUTES.webhooks,
        backLabel: "Back to webhooks",
    },
};

/**
 * The `errorElement` of every area in the route tree. It stands in for the page alone, so
 * the dashboard around it stays, and the router drops it again on the next navigation.
 *
 * A `NotFoundError` is the expected case -- a stale bookmark, a deleted webhook. Anything
 * else is shown as what it is instead of the router's own error screen.
 */
export function RouteError() {
    const error = useRouteError();

    if (error instanceof NotFoundError) {
        const { title, text, backTo, backLabel } = NOT_FOUND[error.subject];
        return (
            <NotFoundCard title={title} backTo={error.backTo ?? backTo} backLabel={backLabel}>
                {text}
            </NotFoundCard>
        );
    }

    return (
        <Card title="Something went wrong" padding="md">
            <p role="alert" className="text-sm text-error break-words">
                {getErrorMessage(error)}
            </p>
        </Card>
    );
}
