import { Server } from "lucide-react";
import { EmptyState } from "@stefgo/react-ui-components";
import { useDirectoryStatus } from "../../../queries/directory";

/**
 * What a list of domain controllers shows while there is none. There is nothing to add:
 * they are found in the directory, so an empty list means the directory has not been asked
 * yet -- and why not is what this says.
 */
export const NoDomainControllers = () => {
    const { data } = useDirectoryStatus();
    const configured = data?.reason !== "not-configured";
    return (
        <EmptyState
            icon={Server}
            title={configured ? "No domain controller found yet" : "The directory is not configured"}
            description={
                configured
                    ? "The domain controllers are read from the directory. It has not answered yet -- the server's log says why."
                    : "Tell the server where the domain is and as whom to ask: directory.urls and directory.bindDn in its config.yaml, and SADM_LDAP_PASSWORD. The domain controllers are then found in the directory."
            }
        />
    );
};
