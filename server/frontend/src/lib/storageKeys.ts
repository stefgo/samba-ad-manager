/**
 * Every key the application writes to the browser's storage, once. **No key literal
 * anywhere else**: a key spelled in a component is one nobody finds again.
 *
 * A key reads `sadm.<area>.<what>`. `<area>` is the page or list that owns the value, so
 * the keys of one page sort together in the browser's storage panel; the prefix keeps
 * them apart from whatever else is served from the same origin.
 *
 * Renaming a key forgets what was stored under the old one. That is the whole cost --
 * every value here is a preference that is set again with one click -- so a rename needs
 * no migration.
 */
export const STORAGE_KEYS = {
    // The shell.
    theme: "sadm.app.theme",
    ui: "sadm.app.ui",
    /** Session storage: when the page last reloaded itself for a chunk that was gone. */
    chunkReloadAt: "sadm.app.chunkReloadAt",

    // Lists: table or cards.
    domainControllersView: "sadm.domainControllers.view",
    activityView: "sadm.activity.view",
    directoryUsersView: "sadm.directory.usersView",
    directoryGroupsView: "sadm.directory.groupsView",
    directoryComputersView: "sadm.directory.computersView",
    /** Which containers of the unit browser are closed. */
    directoryUnitsClosed: "sadm.directory.unitsClosed",
    /** Whether a detail page shows the details it folds away. */
    directoryDetails: "sadm.directory.details",
    dnsZonesView: "sadm.dns.zonesView",
    dnsRecordsView: "sadm.dns.recordsView",
    /** Whether a zone's page shows the details it folds away. */
    dnsZoneDetails: "sadm.dns.zoneDetails",
    usersView: "sadm.users.view",
    webhooksView: "sadm.webhooks.view",

    // A domain controller's page: whether the details below its header are open.
    domainControllerDetails: "sadm.domainController.details",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
