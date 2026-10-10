import { ReactNode } from "react";
import { ServerOff } from "lucide-react";
import { Alert, Card, EmptyState, LoadingIndicator } from "@stefgo/react-ui-components";
import { QueryError } from "../../../components/QueryError";
import { useDirectoryStatus } from "../../../queries/directory";

interface DirectoryGateProps {
    /** The page, told whether the directory can be changed right now. */
    children: (state: { writable: boolean }) => ReactNode;
}

/**
 * Stands in front of every page of the directory. The directory is not the server's: it is
 * read from a domain controller through its agent, on every request -- so before a page
 * asks for a list, this says whether there is anybody to ask, and why not where there is not.
 */
export const DirectoryGate = ({ children }: DirectoryGateProps) => {
    const { data, isPending, error } = useDirectoryStatus();

    if (error && !data) return <QueryError title="Could not ask for the directory" error={error} />;
    if (isPending || !data) return <LoadingIndicator />;

    if (!data.available) {
        return (
            <Card>
                <EmptyState
                    icon={ServerOff}
                    title="No domain controller serves the directory right now"
                    description="The directory is read through the agent of a domain controller. None is connected that has an account in the directory (ldap.bindDn and its password) and directory.enabled set."
                />
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            {!data.writable && (
                <Alert tone="info" title="The directory is read-only">
                    Every connected agent has directory.readOnly set, so nothing can be created, changed or deleted from
                    here.
                </Alert>
            )}
            {children({ writable: data.writable })}
        </div>
    );
};
