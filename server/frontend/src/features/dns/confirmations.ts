import type { ConfirmOptions } from "@stefgo/react-ui-components";
import type { RecordRow } from "./lib/dnsLabels";

/** What goes with deleting a record, said before: a name that stops resolving is noticed by whoever used it. */
export function describeDeleteRecord(row: RecordRow, isLast: boolean): ConfirmOptions {
    const what = `${row.type} ${row.text}`;
    return {
        title: `Delete ${row.node.fqdn} ${row.type}?`,
        description: row.record.protected
            ? `${what} names no domain controller of this domain: it is what a domain controller that was removed left behind. Clients that are sent there wait for an answer that does not come.`
            : isLast
              ? `${what} is the last record of ${row.node.fqdn}. The name stops resolving.`
              : `${what} is removed. The other records of ${row.node.fqdn} stay.`,
        confirmLabel: "Delete",
        variant: "danger",
    };
}
