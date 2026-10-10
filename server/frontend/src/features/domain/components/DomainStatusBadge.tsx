import { Badge } from "@stefgo/react-ui-components";
import type { DomainStatus } from "@sadm/shared";
import { DOMAIN_STATUS } from "../lib/health";

/** A status of the domain or of one domain controller, with what it means as the tooltip. */
export const DomainStatusBadge = ({ status }: { status: DomainStatus }) => (
    <span title={DOMAIN_STATUS[status].description}>
        <Badge variant={DOMAIN_STATUS[status].variant}>{DOMAIN_STATUS[status].label}</Badge>
    </span>
);
