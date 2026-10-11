import { ReactNode } from "react";
import { ServerOff } from "lucide-react";
import { Alert, Card, EmptyState, LoadingIndicator } from "@stefgo/react-ui-components";
import { QueryError } from "../../../components/QueryError";
import { useDirectoryStatus } from "../../../queries/directory";

interface DirectoryGateProps {
    /** The page, told whether the directory can be changed right now. */
    children: (state: { writable: boolean }) => ReactNode;
}

/** Why the directory cannot be used, as the page says it. */
const UNAVAILABLE = {
    "not-configured": {
        title: "The directory is not configured",
        description:
            "Tell the server where the domain is and as whom to ask: directory.urls and directory.bindDn in its config.yaml, and SADM_LDAP_PASSWORD.",
    },
    disabled: {
        title: "The directory is switched off",
        description: "directory.enabled is false in the server's config.yaml: the domain controllers are measured, and no object is shown.",
    },
    unreachable: {
        title: "No domain controller's directory answers right now",
        description: "The directory is read from a domain controller. None answered when it was last measured.",
    },
} as const;

/**
 * Stands in front of every page of the directory. The directory is not the server's: it is
 * read from a domain controller, on every request -- so before a page asks for a list, this
 * says whether there is anybody to ask, and why not where there is not.
 */
export const DirectoryGate = ({ children }: DirectoryGateProps) => {
    const { data, isPending, error } = useDirectoryStatus();

    if (error && !data) return <QueryError title="Could not ask for the directory" error={error} />;
    if (isPending || !data) return <LoadingIndicator />;

    if (!data.available) {
        const why = UNAVAILABLE[data.reason ?? "unreachable"];
        return (
            <Card>
                <EmptyState icon={ServerOff} title={why.title} description={why.description} />
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            {!data.writable && (
                <Alert tone="info" title="The directory is read-only">
                    directory.readOnly is set in the server's config.yaml, so nothing can be created, changed or deleted
                    from here.
                </Alert>
            )}
            {children({ writable: data.writable })}
        </div>
    );
};
