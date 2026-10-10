import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { DescriptionList } from "@stefgo/react-ui-components";
import type { SchedulerId } from "@sadm/shared";
import { useSchedulerStatus } from "../../../queries/scheduler";
import { EMPTY_VALUE, formatDate } from "../../../utils";
import { describeRunResult } from "../lib/runResult";

/**
 * Everything about a scheduler's runs in one box below the settings that shape it: what it
 * is doing and what its last run did, then -- as `children`, usually `ManualRun` -- a way to
 * start a run now. No field borders: these are values to read, not to edit.
 */
export const SchedulerBox = ({ scheduler, children }: { scheduler: SchedulerId; children?: ReactNode }) => {
    const status = useSchedulerStatus(scheduler);
    const lastRun = status?.lastRun ?? null;

    const resultClass =
        lastRun?.status === "failed" || lastRun?.status === "interrupted"
            ? "text-error"
            : lastRun?.status === "partial"
                ? "text-warning"
                : undefined;

    return (
        <div className="mt-8 p-4 bg-hover rounded-xl border border-border">
            <h4 className="text-sm font-bold text-text-primary mb-3">Scheduler</h4>
            <DescriptionList
                columns={3}
                items={[
                    {
                        label: "Status",
                        span: "full",
                        value: status?.isRunning ? (
                            <span className="inline-flex items-center gap-1.5 text-primary">
                                <RefreshCw size={14} className="animate-spin" />
                                Running…
                            </span>
                        ) : (
                            "Idle"
                        ),
                    },
                    {
                        label: "Last Run",
                        value: lastRun ? (
                            <>
                                {formatDate(lastRun.finishedAt ?? lastRun.startedAt)}
                                {lastRun.trigger === "manual" && (
                                    <span className="text-text-muted"> · manual</span>
                                )}
                            </>
                        ) : (
                            EMPTY_VALUE
                        ),
                    },
                    { label: "Next Run", value: status?.nextRun ? formatDate(status.nextRun) : "Disabled" },
                    {
                        label: "Result",
                        value: lastRun ? (
                            <span className={resultClass}>{describeRunResult(scheduler, lastRun)}</span>
                        ) : (
                            EMPTY_VALUE
                        ),
                    },
                ]}
            />
            {children && <div className="mt-4 pt-4 border-t border-border">{children}</div>}
        </div>
    );
};
