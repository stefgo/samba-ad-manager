/**
 * Every key the cache is addressed by, in one place.
 *
 * The keys are hierarchical on purpose: `invalidateQueries({ queryKey: directory.all })`
 * reaches everything that comes to live under `directory`, because a key matches whatever it
 * is a prefix of. `queryKeys.test.ts` holds the prefix relations the code
 * relies on.
 */
export const queryKeys = {
    domainControllers: {
        all: ["domainControllers"] as const,
        list: () => ["domainControllers", "list"] as const,
    },
    dcHealth: {
        all: ["dcHealth"] as const,
        /** What is known of every domain controller, in one entry: the server answers them in one list. */
        states: () => ["dcHealth", "states"] as const,
        /** The thresholds the findings are judged by. */
        options: () => ["dcHealth", "options"] as const,
    },
    directory: {
        /** Everything read out of the directory: a change to any of it may show in all of it. */
        all: ["directory"] as const,
        status: () => ["directory", "status"] as const,
        users: () => ["directory", "users"] as const,
        user: (guid: string) => ["directory", "users", guid] as const,
        groups: () => ["directory", "groups"] as const,
        group: (guid: string) => ["directory", "groups", guid] as const,
        computers: () => ["directory", "computers"] as const,
        computer: (guid: string) => ["directory", "computers", guid] as const,
        tree: () => ["directory", "tree"] as const,
        children: (dn: string) => ["directory", "children", dn] as const,
        /** The DNS zones: kept in the directory, so a change to it is a change to them. */
        dnsZones: () => ["directory", "dns", "zones"] as const,
        dnsZone: (guid: string) => ["directory", "dns", "zones", guid] as const,
    },
    activity: {
        all: ["activity"] as const,
        list: () => ["activity", "list"] as const,
    },
    webhooks: {
        all: ["webhooks"] as const,
        list: () => ["webhooks", "list"] as const,
    },
    settings: {
        all: ["settings"] as const,
        schedulerStatus: () => ["settings", "scheduler-status"] as const,
    },
    users: {
        all: ["users"] as const,
        list: () => ["users", "list"] as const,
    },
};

/**
 * What the server sends by itself on every socket connect: the domain controllers, what is
 * known of each and the activity list (`WebSocketController.handleDashboardConnection`).
 * After a reconnect these are current without being asked for; everything else may have
 * changed while the socket was down and is read again.
 */
const PUSHED_ON_CONNECT: readonly (readonly string[])[] = [
    queryKeys.domainControllers.all,
    queryKeys.dcHealth.states(),
    queryKeys.activity.all,
];

export function isPushedOnConnect(queryKey: readonly unknown[]): boolean {
    return PUSHED_ON_CONNECT.some((prefix) => prefix.every((part, i) => queryKey[i] === part));
}
