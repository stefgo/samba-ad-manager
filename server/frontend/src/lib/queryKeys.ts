/**
 * Every key the cache is addressed by, in one place.
 *
 * The keys are hierarchical on purpose: `invalidateQueries({ queryKey: clients.all })`
 * reaches everything that comes to live under `clients`, because a key matches whatever it
 * is a prefix of. `queryKeys.test.ts` holds the prefix relations the code
 * relies on.
 */
export const queryKeys = {
    clients: {
        all: ["clients"] as const,
        list: () => ["clients", "list"] as const,
    },
    dcHealth: {
        all: ["dcHealth"] as const,
        /** The last measurement of every client, in one entry: the server answers them in one list. */
        states: () => ["dcHealth", "states"] as const,
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
    tokens: {
        all: ["tokens"] as const,
        list: () => ["tokens", "list"] as const,
    },
    users: {
        all: ["users"] as const,
        list: () => ["users", "list"] as const,
    },
};

/**
 * What the server sends by itself on every socket connect: the client list, every client's
 * last reading and the activity list (`WebSocketController.handleDashboardConnection`).
 * After a reconnect these are current without being asked for; everything else may have
 * changed while the socket was down and is read again.
 */
const PUSHED_ON_CONNECT: readonly (readonly string[])[] = [
    queryKeys.clients.all,
    queryKeys.dcHealth.states(),
    queryKeys.activity.all,
];

export function isPushedOnConnect(queryKey: readonly unknown[]): boolean {
    return PUSHED_ON_CONNECT.some((prefix) => prefix.every((part, i) => queryKey[i] === part));
}
