import { Badge } from "@stefgo/react-ui-components";
import type { DirectoryUser } from "@sadm/shared";
import { useNow } from "../../../../hooks/useNow";
import { isExpired } from "../../lib/objectLabels";

/** What state an account is in, as badges: every one that applies, the one that stops a logon first. */
export const UserStatus = ({ user }: { user: Pick<DirectoryUser, "enabled" | "lockedOut" | "mustChangePassword" | "accountExpires"> }) => {
    // The shared clock, so an account that expires while the page is open turns over on it.
    const expired = isExpired(user.accountExpires, useNow());
    return (
        <span className="flex flex-wrap items-center gap-1">
            {!user.enabled && <Badge variant="neutral">Disabled</Badge>}
            {user.lockedOut && <Badge variant="error">Locked out</Badge>}
            {expired && <Badge variant="warning">Expired</Badge>}
            {user.enabled && !user.lockedOut && !expired && <Badge variant="success">Active</Badge>}
            {user.mustChangePassword && <Badge variant="info">Must change password</Badge>}
        </span>
    );
};
