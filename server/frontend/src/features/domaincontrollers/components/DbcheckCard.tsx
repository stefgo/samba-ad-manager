import { useState } from "react";
import { DatabaseZap } from "lucide-react";
import { Badge, Button, Card, DescriptionList, EmptyState, useConfirm, useToast, type DescriptionItem } from "@stefgo/react-ui-components";
import { dbcheckScope, formatDuration, type DcDbcheck, type DomainController } from "@sadm/shared";
import { RelativeTime } from "../../../components/RelativeTime";
import { DOCS } from "../../../lib/docs";
import { useIssueReportToken, useRevokeReportToken } from "../../../queries/domainControllers";
import { getErrorMessage } from "../../../utils";
import { describeReplaceReportToken, describeRevokeReportToken } from "../confirmations";
import { ReportTokenModal } from "./ReportTokenModal";

interface DbcheckCardProps {
    dc: DomainController;
    /** The last check it reported; null before the first report. */
    dbcheck: DcDbcheck | null;
}

/**
 * The database check of one domain controller: the one measurement the server cannot take
 * over the network. A script on the domain controller runs Samba's own check and reports
 * the result here, with a token that is issued on this card.
 */
export const DbcheckCard = ({ dc, dbcheck }: DbcheckCardProps) => {
    const { confirm } = useConfirm();
    const { show } = useToast();
    const issue = useIssueReportToken();
    const revoke = useRevokeReportToken();
    const [token, setToken] = useState<string | null>(null);

    const issueToken = async () => {
        try {
            setToken((await issue.mutateAsync(dc.id)).token);
        } catch (e: unknown) {
            show({ variant: "error", title: "Could not issue the token", description: getErrorMessage(e) });
        }
    };

    const modal = token && <ReportTokenModal dcName={dc.name} token={token} onClose={() => setToken(null)} />;

    if (!dc.dbcheckSince) {
        return (
            <Card title="Database Check">
                <EmptyState
                    icon={DatabaseZap}
                    title="No database check is reported"
                    description={
                        <>
                            Samba's database check runs on the domain controller itself, from a script that reports here.{" "}
                            <a href={DOCS.dbcheck} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                How to set it up
                            </a>
                        </>
                    }
                    action={
                        <Button size="sm" onClick={() => void issueToken()} isLoading={issue.isPending}>
                            Issue report token
                        </Button>
                    }
                />
                {modal}
            </Card>
        );
    }

    const items: DescriptionItem[] = [
        {
            label: "Result",
            value: !dbcheck ? (
                "Nothing reported yet"
            ) : dbcheck.errors === null ? (
                <span className="text-error">Could not be run: {dbcheck.error ?? "unknown reason"}</span>
            ) : (
                <Badge variant={dbcheck.errors === 0 ? "success" : "warning"}>
                    {dbcheck.errors} {dbcheck.errors === 1 ? "error" : "errors"}
                </Badge>
            ),
        },
        {
            label: "Covers",
            value: !dbcheck ? (
                "–"
            ) : dbcheckScope(dbcheck) === "all" ? (
                "Every partition"
            ) : (
                <>
                    The domain partition only — not the DNS zones, the configuration or the schema.{" "}
                    <a href={DOCS.dbcheck} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        Replace the script
                    </a>
                </>
            ),
        },
        { label: "Checked", value: dbcheck ? <RelativeTime date={dbcheck.checkedAt} /> : "–" },
        { label: "Reported", value: dbcheck ? <RelativeTime date={dbcheck.receivedAt} /> : "–" },
        { label: "Took", value: typeof dbcheck?.durationMs === "number" ? formatDuration(dbcheck.durationMs / 1000) : "–" },
        { label: "Expected Since", value: <RelativeTime date={dc.dbcheckSince} /> },
    ];

    return (
        <Card
            title="Database Check"
            padding="md"
            action={
                <div className="flex flex-wrap gap-2">
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => confirm({ ...describeReplaceReportToken(dc), onConfirm: issueToken })}
                    >
                        New token
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => confirm({ ...describeRevokeReportToken(dc), onConfirm: () => revoke.mutateAsync(dc.id) })}
                    >
                        Stop expecting reports
                    </Button>
                </div>
            }
        >
            <DescriptionList items={items} columns={2} />
            {modal}
        </Card>
    );
};
