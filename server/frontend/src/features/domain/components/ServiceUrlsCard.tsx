import { Link } from "react-router-dom";
import { Badge, Card, FOCUS_RING, StatusDot, cn } from "@stefgo/react-ui-components";
import type { DomainHealth } from "@sadm/shared";
import { useNow } from "../../../hooks/useNow";
import { paths } from "../../../lib/paths";
import { formatDate } from "../../../utils";
import { SERVICE_URL_STATE_LABELS, certificateLeft, serviceUrlRows } from "../lib/serviceUrls";

/**
 * The names applications reach the directory under (`directory.serviceUrls`): whether each
 * answers, which domain controller does -- the one that holds the address -- and until when
 * its certificate holds. Nothing to show without any.
 */
export const ServiceUrlsCard = ({ domain }: { domain: DomainHealth }) => {
    const now = useNow();
    const rows = serviceUrlRows(domain);
    if (rows.length === 0) return null;

    return (
        <Card title="Central URLs" titleAs="h2">
            <ul className="divide-y divide-border">
                {rows.map((row) => (
                    <li key={row.url} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                            <StatusDot tone={row.tone} pulse={false} />
                            <span className="truncate font-medium text-text-primary">{row.url}</span>
                            {row.answeredBy && (
                                <span className="text-xs text-text-muted">
                                    via{" "}
                                    {row.dcId ? (
                                        <Link
                                            to={paths.domainController(row.dcId)}
                                            className={cn("rounded-sm font-medium text-text-primary hover:text-primary", FOCUS_RING)}
                                        >
                                            {row.answeredBy}
                                        </Link>
                                    ) : (
                                        row.answeredBy
                                    )}
                                </span>
                            )}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                            {row.detail && <span>{row.detail}</span>}
                            {row.validTo && (
                                <span>
                                    Certificate until {formatDate(row.validTo)} · {certificateLeft(row.validTo, now)}
                                </span>
                            )}
                            <Badge variant={row.tone}>{SERVICE_URL_STATE_LABELS[row.state]}</Badge>
                        </span>
                    </li>
                ))}
            </ul>
        </Card>
    );
};
