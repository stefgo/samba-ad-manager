import { lazy } from "react";

// Page components -- loaded on demand, so a chunk only arrives when its route does.
// A `.ts` file of its own: the route files next to it export route elements and the
// tree, and Fast Refresh wants a file to export components or other things, not both.
export const DashboardOverview = lazy(() =>
    import("../dashboard/components/DashboardOverview").then((m) => ({ default: m.DashboardOverview })),
);
export const ManagedClients = lazy(() =>
    import("../domaincontrollers/components/ManagedClients").then((m) => ({ default: m.ManagedClients })),
);
export const ClientOverview = lazy(() =>
    import("../domaincontrollers/components/ClientOverview").then((m) => ({ default: m.ClientOverview })),
);
export const ClientEditor = lazy(() =>
    import("../domaincontrollers/components/ClientEditor").then((m) => ({ default: m.ClientEditor })),
);
export const AddClientWizard = lazy(() =>
    import("../domaincontrollers/components/add-client/AddClientWizard").then((m) => ({
        default: m.AddClientWizard,
    })),
);
export const DirectoryUserList = lazy(() =>
    import("../directory/components/users/UserList").then((m) => ({ default: m.UserList })),
);
export const DirectoryUserDetail = lazy(() =>
    import("../directory/components/users/UserDetail").then((m) => ({ default: m.UserDetail })),
);
export const DirectoryGroupList = lazy(() =>
    import("../directory/components/groups/GroupList").then((m) => ({ default: m.GroupList })),
);
export const DirectoryGroupDetail = lazy(() =>
    import("../directory/components/groups/GroupDetail").then((m) => ({ default: m.GroupDetail })),
);
export const DirectoryComputerList = lazy(() =>
    import("../directory/components/computers/ComputerList").then((m) => ({ default: m.ComputerList })),
);
export const DirectoryComputerDetail = lazy(() =>
    import("../directory/components/computers/ComputerDetail").then((m) => ({ default: m.ComputerDetail })),
);
export const DirectoryUnitBrowser = lazy(() =>
    import("../directory/components/units/UnitBrowser").then((m) => ({ default: m.UnitBrowser })),
);
export const ActivityView = lazy(() =>
    import("../activity/components/ActivityView").then((m) => ({ default: m.ActivityView })),
);
export const UserOverview = lazy(() =>
    import("../accounts/components/UserOverview").then((m) => ({ default: m.UserOverview })),
);
export const TokenOverview = lazy(() =>
    import("../tokens/components/TokenOverview").then((m) => ({ default: m.TokenOverview })),
);
export const WebhookOverview = lazy(() =>
    import("../webhooks/components/WebhookOverview").then((m) => ({ default: m.WebhookOverview })),
);
export const WebhookEditorRoute = lazy(() =>
    import("../webhooks/components/WebhookEditor").then((m) => ({ default: m.WebhookEditorRoute })),
);
export const Settings = lazy(() => import("../../pages/Settings"));
