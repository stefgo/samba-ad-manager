import { useState } from "react";
import { Cpu } from "lucide-react";
import { Badge, Button, Card, DescriptionList, EmptyState, useConfirm, useToast, type DescriptionItem } from "@stefgo/react-ui-components";
import type { CreatedAgentToken, DomainController } from "@sadm/shared";
import { RelativeTime } from "../../../components/RelativeTime";
import { DOCS } from "../../../lib/docs";
import { useConnectAgent, useIssueAgentToken, useRemoveAgent } from "../../../queries/domainControllers";
import { EMPTY_VALUE, getErrorMessage } from "../../../utils";
import { describeRemoveAgent } from "../confirmations";
import { agentDirection } from "../lib/agentForm";
import { AgentTokenModal } from "./AgentTokenModal";
import { ConnectAgentDialog } from "./ConnectAgentDialog";

interface AgentCardProps {
    dc: DomainController;
}

/**
 * The agent of one domain controller: a process in its container that reports what the
 * server cannot read over the network. Optional -- a domain controller without one is
 * measured like any other -- and set up from here, either with a token the agent registers
 * with or by having the server dial it.
 */
export const AgentCard = ({ dc }: AgentCardProps) => {
    const { confirm } = useConfirm();
    const { show } = useToast();
    const issue = useIssueAgentToken();
    const connect = useConnectAgent();
    const remove = useRemoveAgent();
    const [token, setToken] = useState<CreatedAgentToken | null>(null);
    const [connecting, setConnecting] = useState(false);

    const issueToken = async () => {
        try {
            setToken(await issue.mutateAsync(dc.id));
        } catch (e: unknown) {
            show({ variant: "error", title: "Could not issue the token", description: getErrorMessage(e) });
        }
    };

    const dialogs = (
        <>
            {token && <AgentTokenModal dcName={dc.name} token={token.token} expiresAt={token.expiresAt} onClose={() => setToken(null)} />}
            {connecting && (
                <ConnectAgentDialog dc={dc} onClose={() => setConnecting(false)} onConnect={(data) => connect.mutateAsync({ id: dc.id, data })} />
            )}
        </>
    );

    const { agent } = dc;
    if (!agent) {
        return (
            <Card title="Agent">
                <EmptyState
                    icon={Cpu}
                    title="No agent"
                    description={
                        <>
                            An agent in the domain controller's container reports what cannot be read over the network: which of
                            Samba's services run, how full the storage is, what the sysvol holds, and the database check.{" "}
                            <a href={DOCS.agent} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                How to set it up
                            </a>
                        </>
                    }
                    action={
                        <div className="flex flex-wrap justify-center gap-2">
                            <Button size="sm" onClick={() => void issueToken()} isLoading={issue.isPending}>
                                Issue registration token
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setConnecting(true)}>
                                Connect to agent
                            </Button>
                        </div>
                    }
                />
                {dialogs}
            </Card>
        );
    }

    const items: DescriptionItem[] = [
        {
            label: "Connection",
            value: <Badge variant={agent.connected ? "success" : "warning"}>{agent.connected ? "Connected" : "Not connected"}</Badge>,
        },
        { label: "Direction", value: agentDirection(agent) },
        { label: "Host", value: agent.hostname ?? EMPTY_VALUE },
        { label: "Version", value: agent.version ?? EMPTY_VALUE },
        { label: "Registered", value: <RelativeTime date={agent.registeredAt} /> },
        {
            label: agent.connected ? "Connected Since" : "Last Seen",
            value: agent.lastSeen ? <RelativeTime date={agent.lastSeen} /> : "Never",
        },
    ];

    return (
        <Card
            title="Agent"
            padding="md"
            action={
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => confirm({ ...describeRemoveAgent(dc), onConfirm: () => remove.mutateAsync(dc.id) })}
                >
                    Remove agent
                </Button>
            }
        >
            <DescriptionList items={items} columns={2} />
            {dialogs}
        </Card>
    );
};
