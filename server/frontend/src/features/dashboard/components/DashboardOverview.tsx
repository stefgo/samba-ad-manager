import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Database, Server, ShieldCheck } from "lucide-react";
import { Card, EmptyState, StatCard } from "@stefgo/react-ui-components";
import { useClients } from "../../../queries/clients";
import { QueryError } from "../../../components/QueryError";
import { useActivity } from "../../../queries/activity";
import { ActivityView } from "../../activity/components/ActivityView";
import { ClientList } from "../../domaincontrollers/components/ClientList";
import { SEARCH_PARAM, paths } from "../../../lib/paths";
import { clientCount, formatOnlineCount, hostSummary, objectSummary, problemSummary, unseenProblems } from "../lib/dashboard";
import { useDomainHealth } from "../../domain/hooks/useDomainHealth";
import { DomainOverviewCard } from "../../domain/components/DomainOverviewCard";
import { IssueList } from "../../domain/components/IssueList";
import { DOMAIN_STATUS } from "../../domain/lib/health";

/**
 * The list a card opens beneath the cards. One at a time: the lists keep their search in
 * the same `search` parameter, so two open at once would filter each other. Kept in the
 * `panel` parameter, so the open list survives a reload and travels with a shared link.
 */
const PANELS = ["hosts", "activity"] as const;
type Panel = (typeof PANELS)[number];
const PANEL_PARAM = "panel";
const PANEL_ID = "dashboard-panel";

/** An icon with nothing to say; one that has something takes the colour of what it says. */
const QUIET = "text-text-muted";

const toPanel = (value: string | null): Panel | null =>
    (PANELS as readonly (string | null)[]).includes(value) ? (value as Panel) : null;

const STATUS_ICON = { healthy: "text-success", degraded: "text-warning", critical: "text-error", unknown: QUIET } as const;

/**
 * The landing page: how the domain is doing, how many domain controllers report, what the
 * directory holds and what in the activity asks for a look. Below the numbers the domain
 * itself, and whatever is wrong with it.
 */
export const DashboardOverview = () => {
    const navigate = useNavigate();
    const { clients, error: clientsError } = useClients();
    const { events } = useActivity();
    const { domain } = useDomainHealth();
    const [searchParams, setSearchParams] = useSearchParams();
    const panel = toPanel(searchParams.get(PANEL_PARAM));
    // A second click on the open card closes its list again. The search is dropped either
    // way: a name typed into one list would otherwise filter the next one to nothing.
    // One write for both: two `setSearchParams` in a row would each start from the same URL,
    // and the second would undo the first. It replaces the history entry, as the search does.
    const togglePanel = (next: Panel) => {
        setSearchParams(
            (prev) => {
                const params = new URLSearchParams(prev);
                if (toPanel(prev.get(PANEL_PARAM)) === next) {
                    params.delete(PANEL_PARAM);
                } else {
                    params.set(PANEL_PARAM, next);
                }
                params.delete(SEARCH_PARAM);
                return params;
            },
            { replace: true },
        );
    };

    const hosts = useMemo(() => clientCount(clients), [clients]);
    const problems = useMemo(() => unseenProblems(events), [events]);

    // Zeroes would say no domain controller is registered, which is another statement altogether.
    if (clientsError) return <QueryError title="Could not load the domain controllers" error={clientsError} />;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                <StatCard
                    label="Domain"
                    value={DOMAIN_STATUS[domain.status].label}
                    sub={
                        domain.issues.length > 0
                            ? `${domain.issues.length} ${domain.issues.length === 1 ? "finding" : "findings"}`
                            : DOMAIN_STATUS[domain.status].description
                    }
                    icon={ShieldCheck}
                    classNames={{ icon: STATUS_ICON[domain.status] }}
                />
                <StatCard
                    label="Domain controllers online"
                    value={formatOnlineCount(hosts)}
                    sub={hostSummary(hosts)}
                    icon={Server}
                    onClick={() => togglePanel("hosts")}
                    selected={panel === "hosts"}
                    aria-expanded={panel === "hosts"}
                    classNames={{ icon: hosts.online < hosts.total ? "text-warning" : QUIET }}
                    aria-controls={PANEL_ID}
                />
                <StatCard
                    label="Directory objects"
                    value={domain.counts ? String(domain.counts.users + domain.counts.groups + domain.counts.computers) : "–"}
                    sub={objectSummary(domain.counts)}
                    icon={Database}
                    classNames={{ icon: QUIET }}
                />
                <StatCard
                    label="Errors / Warnings"
                    value={String(problems.errors + problems.warnings)}
                    sub={problemSummary(problems)}
                    icon={AlertTriangle}
                    onClick={() => togglePanel("activity")}
                    selected={panel === "activity"}
                    aria-expanded={panel === "activity"}
                    classNames={{
                        icon: problems.errors > 0 ? "text-error" : problems.warnings > 0 ? "text-warning" : QUIET,
                    }}
                    aria-controls={PANEL_ID}
                />
            </div>

            {panel && (
                <div id={PANEL_ID}>
                    {panel === "hosts" && (
                        <ClientList
                            clients={clients}
                            setSelectedClient={(client) => client && navigate(paths.client(client.id))}
                        />
                    )}
                    {panel === "activity" && <ActivityView initialLevel="warning" />}
                </div>
            )}


            {clients.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={Server}
                        title="No domain controller registered yet"
                        description="Add a domain controller under Domain Controllers, then start its agent with the registration token it is given."
                    />
                </Card>
            ) : (
                <DomainOverviewCard domain={domain} />
            )}

            {domain.issues.length > 0 && (
                <Card title="Needs attention" titleAs="h2">
                    <IssueList issues={domain.issues} />
                </Card>
            )}
        </div>
    );
};
