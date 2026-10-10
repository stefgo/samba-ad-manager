import { Client, CONNECTION_MODE } from "@sadm/shared";
import type { ConfirmOptions } from "@stefgo/react-ui-components";
import { clientName } from "../../utils";

/**
 * What goes with the row is the server's side only. Nothing on the domain controller
 * changes, and the agent keeps running
 * with credentials the server no longer accepts -- the part an operator does not expect,
 * and so the part spelled out.
 */
export function describeDeleteClient(client: Client): ConfirmOptions {
    return {
        title: `Delete "${clientName(client)}"?`,
        description:
            (client.connectionMode === CONNECTION_MODE.OUTBOUND
                ? "The server stops connecting to this domain controller's agent and forgets it."
                : "The server forgets this domain controller's agent and refuses it from now on.") +
            " Samba and the directory are not touched. To manage the domain controller again, its agent has to be registered anew.",
        confirmLabel: "Delete",
        variant: "danger",
    };
}
