import { ReactNode } from "react";
import {
    Client,
    CLIENT_STATUS,
    DEFAULT_AGENT_PORT,
    Ipv4OrCidrSchema,
    isIpAllowed,
} from "@sadm/shared";
import { Save } from "lucide-react";
import { Badge, Button, Card, Checkbox, DescriptionList, Input, StatusDot, FieldLabel } from "@stefgo/react-ui-components";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { clientName } from "../../../utils";
import { RelativeTime } from "../../../components/RelativeTime";
import type { EntityForm } from "../../../hooks/useEntityForm";
import { isOutbound, type ClientDraft, type ClientUpdateInput } from "../lib/clientForm";

interface ClientIdentityCardProps {
    client: Client;
    /** The draft and its state. Held by the page, which also has to know whether it is dirty. */
    form: EntityForm<ClientDraft, ClientUpdateInput>;
    /** Saves the form. The card only says when. */
    onSubmit: () => void;
    /**
     * Placed in the card header. The page passes its close control here rather than
     * rendering one of its own: the header is the one part of a card that stays in reach
     * no matter how far down the form the operator has scrolled.
     */
    action?: ReactNode;
}

/**
 * Name, site and address of a client -- everything
 * `PUT /api/v1/clients/:id` owns, and nothing else. One save button for one resource is the
 * only arrangement in which a button cannot silently drop what the operator typed into a
 * field it does not submit.
 *
 * The card does not decide what leaving means -- the page does, and hands it in as
 * `action`. Save stays here, because it belongs to these fields; the way out belongs to
 * the surface that opened them.
 */
export const ClientIdentityCard = ({ client, form, onSubmit, action }: ClientIdentityCardProps) => {
    const { draft, set, errors, isSaving } = form;
    const isInbound = !isOutbound(client);
    const allowedIpTrimmed = draft.allowedIp.trim();

    /**
     * The agent cannot object to a value that shuts it out, and the mistake only surfaces at
     * its next reconnect -- possibly hours later, by which time an offline client is all
     * there is to go on. The address of its last successful connect is the one piece of
     * evidence available while the field is still open, so the form says outright when the
     * value under the cursor would not let that address back in.
     */
    const wouldLockOut =
        isInbound &&
        draft.restrictIp &&
        !!client.inboundLastIp &&
        !!allowedIpTrimmed &&
        !errors.allowedIp &&
        // A stored value the check cannot read is left alone, not reported as a lockout.
        Ipv4OrCidrSchema.safeParse(allowedIpTrimmed).success &&
        !isIpAllowed(client.inboundLastIp, allowedIpTrimmed);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit();
    };

    const error = form.saveError ?? form.formError;
    const saved = form.saved;

    return (
        <Card
            className="flex flex-col"
            title={
                <div className="flex items-center gap-4">
                    <StatusDot tone={client.status === CLIENT_STATUS.ONLINE ? "success" : "neutral"} size="md" />
                    <div className="min-w-0">
                        <HeaderBreadcrumb>{clientName(client)}</HeaderBreadcrumb>
                        {/* Only while offline: for a connected client the pulsing dot
                            already says the agent is here, and a timestamp beside it just
                            invites the question whether it is stale. */}
                        {client.status !== CLIENT_STATUS.ONLINE && (
                            <div className="text-xs font-normal text-text-muted mt-1">
                                Last seen <RelativeTime date={client.lastSeen} />
                            </div>
                        )}
                    </div>
                </div>
            }
            titleAs="div"
            action={action}
            classNames={{ header: "py-5 px-7" }}
        >
            <div className="px-7 py-6 bg-card">
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* A `DescriptionList` for its copy button. The classes line its label
                        and value up with the read-only fields below. */}
                    <DescriptionList
                        columns={1}
                        items={[{ label: "Client ID", value: client.id, copyable: client.id }]}
                        classNames={{ label: "mb-1.5 ml-1", value: "ml-1" }}
                    />

                    {/* Read-only, and first after the id: it decides whether there is a target
                        address or an IP restriction below at all, so it reads as context for
                        the fields under it rather than as a footnote after them. */}
                    <div>
                        {/* Not an `Input`: there is no control to label. The caption is the one
                            an input gets, and the hint's classes are copied from it, so a
                            read-only value lines up with the editable fields under it. */}
                        <FieldLabel as="div">Connection Mode</FieldLabel>
                        {/* `lg` is text-sm -- the size the inputs and the agent version
                            below use, so the read-only value does not read as a footnote. */}
                        <Badge variant="info">
                            {isInbound ? "Inbound" : "Outbound"}
                        </Badge>
                        <p className="mt-1 text-xs text-text-muted leading-relaxed ml-1">
                            {isInbound
                                ? "The agent dials the server and keeps the connection open."
                                : "The server dials the agent's web server at the address below."}
                        </p>
                    </div>

                    <div>
                        <FieldLabel as="div">Agent Version</FieldLabel>
                        {/* Always rendered, even without a value: a field that vanishes reads
                            as "not applicable", while an agent that has never reported one is
                            a fact worth seeing. */}
                        <span className="ml-1 text-sm text-text-primary">
                            {client.version || "Unknown"}
                        </span>
                        {!client.version && (
                            <p className="mt-1 text-xs text-text-muted leading-relaxed ml-1">
                                Reported by the agent on connect -- an agent that has not
                                connected yet has none.
                            </p>
                        )}
                    </div>

                    <Input
                        label="Display Name"
                        value={draft.displayName}
                        onChange={(e) => set("displayName", e.target.value)}
                        error={errors.displayName}
                        placeholder={client.hostname}
                        disabled={isSaving}
                        hint={`Leave empty to use hostname (${client.hostname})`}
                        autoFocus
                    />

                    <Input
                        label="Site"
                        value={draft.site}
                        onChange={(e) => set("site", e.target.value)}
                        error={errors.site}
                        placeholder="e.g. dc-berlin"
                        maxLength={100}
                        disabled={isSaving}
                        hint="A label for where this domain controller stands. The list groups by it. Leave empty if you have one location."
                    />

                    {isInbound && (
                        <div className="space-y-4">
                            {/* A Checkbox rather than a Switch: this form is submitted by its
                                save button, and a switch would claim to take effect on the spot. */}
                            <Checkbox
                                label="Restrict connections to an IP address or network"
                                checked={draft.restrictIp}
                                onChange={(e) => set("restrictIp", e.target.checked)}
                                disabled={isSaving}
                                hint={
                                    draft.restrictIp
                                        ? "The agent is refused when it connects from anywhere else."
                                        : `The agent's token is accepted from any address the server's allowed_networks permit. Suited to hosts whose address is assigned by their environment.${
                                              client.inboundLastIp
                                                  ? ` Its last successful connection came from ${client.inboundLastIp}.`
                                                  : ""
                                          }`
                                }
                            />

                            {draft.restrictIp && (
                                <Input
                                    label="Allowed IP or Network"
                                    value={draft.allowedIp}
                                    onChange={(e) => set("allowedIp", e.target.value)}
                                    placeholder="192.168.1.50 or 192.168.1.0/24"
                                    disabled={isSaving}
                                    error={errors.allowedIp}
                                    hint={
                                        client.inboundLastIp
                                            ? `An agent that connects from a different address is refused at its next reconnect. Its last successful connection came from ${client.inboundLastIp}.`
                                            : "An agent that connects from a different address is refused at its next reconnect."
                                    }
                                />
                            )}

                            {/* Not the field's `error`: the value is well-formed and storable,
                                and the agent may well have moved on purpose. It is a
                                consequence worth seeing before saving, not a reason to refuse
                                -- an `error` here would block Save and make the operator's
                                decision for them. */}
                            {wouldLockOut && (
                                <p className="text-xs text-error leading-relaxed ml-1">
                                    This value would not let {client.inboundLastIp} back in --
                                    the agent is refused at its next reconnect.
                                </p>
                            )}
                        </div>
                    )}

                    {!isInbound && (
                        <Input
                            label="Target Address"
                            value={draft.targetAddress}
                            onChange={(e) => set("targetAddress", e.target.value)}
                            placeholder={`192.168.1.100:${DEFAULT_AGENT_PORT}`}
                            disabled={isSaving}
                            error={errors.targetAddress}
                            hint={`Host and port of the agent's web server. Without a port, :${DEFAULT_AGENT_PORT} is used. Saving reconnects to the new address at once.`}
                            required
                        />
                    )}

                    <div className="flex items-center justify-end gap-4 border-t border-border pt-5">
                        {error && <span className="text-sm text-error mr-auto">{error}</span>}
                        {!error && saved && (
                            <span className="text-sm text-success mr-auto">Client saved</span>
                        )}
                        <Button
                            type="submit"
                            variant="primary"
                            isLoading={isSaving}
                            disabled={!form.canSave}
                            icon={Save}
                            className="shadow-glow-accent"
                        >
                            Save
                        </Button>
                    </div>
                </form>
            </div>
        </Card>
    );
};
