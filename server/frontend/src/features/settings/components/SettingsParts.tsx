import { ManualRun as LibraryManualRun, type ManualRunProps } from "@stefgo/react-ui-components";
import { describeFailure } from "../../../utils";

/**
 * "Run the job now", at the foot of the scheduler box. The library's `ManualRun`, reading a
 * failure the way the rest of the app does.
 */
export const ManualRun = (props: Omit<ManualRunProps, "formatError">) => (
    <LibraryManualRun formatError={describeFailure} {...props} />
);
