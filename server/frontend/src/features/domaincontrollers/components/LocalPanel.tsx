import { Badge, Card, DescriptionList, StatusDot, type DescriptionItem } from "@stefgo/react-ui-components";
import {
    formatBytes,
    missingSambaServices,
    sambaServiceLabel,
    sysvolPolicies,
    type DcHealth,
    type DcLocal,
    type SysvolPolicyState,
} from "@sadm/shared";
import { RelativeTime } from "../../../components/RelativeTime";
import { useNow } from "../../../hooks/useNow";
import { EMPTY_VALUE } from "../../../utils";

interface LocalPanelProps {
    health: DcHealth;
    local: DcLocal;
    /** Whether the agent is connected. What it left behind is shown, and said to be old. */
    connected: boolean;
}

const SYSVOL_STATE: Record<SysvolPolicyState, { tone: "success" | "warning" | "neutral"; note: string }> = {
    "in-step": { tone: "success", note: "In step" },
    pending: { tone: "neutral", note: "Changed just now" },
    missing: { tone: "warning", note: "Not in the sysvol" },
    unreadable: { tone: "warning", note: "No readable GPT.INI" },
    differs: { tone: "warning", note: "Another version" },
};

const row = "flex items-center justify-between gap-3 px-4 py-2.5 text-sm";

/**
 * What the agent of a domain controller read on it: the services of the Samba process, the
 * programs its supervisor runs, the storage, and the group policies in its sysvol next to
 * what the directory says of them. What is wrong with any of it is a finding, above; this
 * is the reading itself.
 */
export const LocalPanel = ({ health, local, connected }: LocalPanelProps) => {
    const now = useNow();
    const missing = new Set(local.services ? missingSambaServices(local.services) : []);
    const policies = sysvolPolicies(health, now);
    const { storage } = local;

    const storageItems: DescriptionItem[] = storage
        ? [
              {
                  label: "Free",
                  value: `${formatBytes(storage.freeBytes)} of ${formatBytes(storage.totalBytes)}${
                      storage.totalBytes > 0 ? ` (${Math.floor((storage.freeBytes / storage.totalBytes) * 100)} %)` : ""
                  }`,
              },
              { label: "Directory Database", value: typeof storage.databaseBytes === "number" ? formatBytes(storage.databaseBytes) : EMPTY_VALUE },
              { label: "Path", value: storage.path, copyable: storage.path, span: "full" },
          ]
        : [];

    return (
        <div className="space-y-6">
            {(local.errors.length > 0 || !connected) && (
                <Card title="Not Read Locally">
                    <ul className="divide-y divide-border">
                        {!connected && (
                            <li className="px-4 py-3 text-sm text-text-muted">
                                The agent is not connected. What follows is what it reported <RelativeTime date={local.receivedAt} />.
                            </li>
                        )}
                        {local.errors.map((error) => (
                            <li key={error.source} className="px-4 py-3 text-sm">
                                <span className="font-medium text-text-primary">{error.source}</span>
                                <span className="text-text-muted"> — {error.message}</span>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {local.services && (
                    <Card title="Samba Services">
                        <ul className="divide-y divide-border">
                            {local.services.configured.map((name) => (
                                <li key={name} className={row}>
                                    <span className="flex min-w-0 items-center gap-2">
                                        <StatusDot tone={missing.has(name) ? "error" : "success"} pulse={false} />
                                        <span className="truncate font-medium text-text-primary">{sambaServiceLabel(name)}</span>
                                    </span>
                                    <span className={missing.has(name) ? "text-right text-xs text-error" : "text-right text-xs text-text-muted"}>
                                        {missing.has(name) ? "Not running" : "Configured"}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </Card>
                )}

                {local.processes && (
                    <Card title="Processes">
                        <ul className="divide-y divide-border">
                            {local.processes.map((process) => (
                                <li key={process.name} className={row}>
                                    <span className="flex min-w-0 items-center gap-2">
                                        <StatusDot tone={process.state === "RUNNING" ? "success" : process.state === "STARTING" ? "neutral" : "error"} pulse={false} />
                                        <span className="truncate font-medium text-text-primary">{process.name}</span>
                                        {(process.recentStarts ?? 0) > 1 && <Badge variant="warning">{process.recentStarts} starts in an hour</Badge>}
                                    </span>
                                    <span className="text-right text-xs text-text-muted">
                                        {process.state === "RUNNING" && process.startedAt ? (
                                            <>
                                                Started <RelativeTime date={process.startedAt} />
                                            </>
                                        ) : (
                                            process.state.toLowerCase()
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </Card>
                )}
            </div>

            {storage && (
                <Card title="Storage" padding="md">
                    <DescriptionList items={storageItems} columns={2} />
                </Card>
            )}

            {policies && policies.length > 0 && (
                <Card title="Group Policies in the Sysvol">
                    <ul className="divide-y divide-border">
                        {policies.map((policy) => (
                            <li key={policy.guid} className={row}>
                                <span className="flex min-w-0 items-center gap-2">
                                    <StatusDot tone={SYSVOL_STATE[policy.state].tone} pulse={false} />
                                    <span className="truncate font-medium text-text-primary">{policy.name ?? policy.guid}</span>
                                </span>
                                <span className="text-right text-xs text-text-muted">
                                    {policy.state === "in-step"
                                        ? `Version ${policy.directoryVersion}`
                                        : `${SYSVOL_STATE[policy.state].note}: ${policy.sysvolVersion ?? "none"}, the directory says ${policy.directoryVersion}`}
                                </span>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    );
};
