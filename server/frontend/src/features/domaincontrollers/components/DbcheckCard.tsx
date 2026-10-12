import { useState } from "react";
import { DatabaseZap } from "lucide-react";
import { Badge, Button, Card, DescriptionList, EmptyState, useToast, type DescriptionItem } from "@stefgo/react-ui-components";
import { AGENT_CAPABILITIES, formatDuration, type DcDbcheck, type DomainController } from "@sadm/shared";
import { RelativeTime } from "../../../components/RelativeTime";
import { DOCS } from "../../../lib/docs";
import { runDbcheck } from "../../../queries/domainControllers";
import { EMPTY_VALUE, getErrorMessage } from "../../../utils";

interface DbcheckCardProps {
    dc: DomainController;
    /** The last check its agent reported; null before the first report. */
    dbcheck: DcDbcheck | null;
}

/**
 * The database check of one domain controller: Samba's own check of its local database,
 * which only the domain controller itself can run. Its agent runs it once a day and when
 * asked from here.
 */
export const DbcheckCard = ({ dc, dbcheck }: DbcheckCardProps) => {
    const { show } = useToast();
    const [isAsking, setIsAsking] = useState(false);
    const { agent } = dc;

    if (!agent || !agent.capabilities.includes(AGENT_CAPABILITIES.DBCHECK)) {
        return (
            <Card title="Database Check">
                <EmptyState
                    icon={DatabaseZap}
                    title="No database check"
                    description={
                        <>
                            Samba's database check reads the local database of the domain controller, so it is run by the agent
                            there{agent ? ", and this one has not said that it runs it" : " — and this domain controller has none"}.{" "}
                            <a href={DOCS.dbcheck} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                About the database check
                            </a>
                        </>
                    }
                />
            </Card>
        );
    }

    // The result arrives over the socket, minutes later, so the toast is all that says the click was taken.
    const handleCheck = async () => {
        setIsAsking(true);
        try {
            await runDbcheck(dc.id);
            show({
                variant: "success",
                title: `The database check of ${dc.name} was started`,
                description: "It reads every object of the directory. The result shows here when it is done.",
            });
        } catch (e: unknown) {
            show({ variant: "error", title: "Could not start the database check", description: getErrorMessage(e) });
        } finally {
            setIsAsking(false);
        }
    };

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
        { label: "Took", value: typeof dbcheck?.durationMs === "number" ? formatDuration(dbcheck.durationMs / 1000) : EMPTY_VALUE },
        { label: "Checked", value: dbcheck ? <RelativeTime date={dbcheck.checkedAt} /> : EMPTY_VALUE },
        { label: "Reported", value: dbcheck ? <RelativeTime date={dbcheck.receivedAt} /> : EMPTY_VALUE },
    ];

    return (
        <Card
            title="Database Check"
            padding="md"
            action={
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleCheck()}
                    isLoading={isAsking}
                    disabled={!agent.connected}
                    title={agent.connected ? undefined : "The agent is not connected"}
                >
                    Check now
                </Button>
            }
        >
            <DescriptionList items={items} columns={2} />
        </Card>
    );
};
