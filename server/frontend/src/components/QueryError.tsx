import { Alert } from "@stefgo/react-ui-components";
import { getErrorMessage } from "../utils";

interface QueryErrorProps {
    /** What could not be read, as a sentence: "Could not load the users". */
    title: string;
    error: unknown;
}

/**
 * The one way a page says that its data could not be read: what failed, and the server's
 * own words for why. Shown instead of the list -- an empty list below a toast says there
 * is nothing, which is another statement altogether.
 *
 * The library's `Alert`; what stays here is how this app reads an error.
 */
export const QueryError = ({ title, error }: QueryErrorProps) => (
    <div className="p-6">
        <Alert title={title}>{getErrorMessage(error)}</Alert>
    </div>
);
