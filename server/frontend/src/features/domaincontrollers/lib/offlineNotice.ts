import { formatDate } from "../../../utils";

/**
 * What the page of a client that is not connected says in place of its measurements:
 * since when it is gone. An empty page below a header reads as a broken one.
 */
export interface OfflineNotice {
    title: string;
    lines: string[];
}

export function offlineNotice({ lastSeen }: { lastSeen?: string | null }, locale?: string): OfflineNotice {
    return {
        title: lastSeen
            ? `This domain controller's agent is offline, last seen ${formatDate(lastSeen, { locale })}`
            : "This domain controller's agent has not connected yet",
        lines: ["Nothing is known about the domain controller while its agent is away."],
    };
}
