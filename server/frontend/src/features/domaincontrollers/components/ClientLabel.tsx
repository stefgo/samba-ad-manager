import { StatusDot } from "@stefgo/react-ui-components";
import { EMPTY_VALUE } from "../../../utils";

interface ClientLabelProps {
    /** The client's name as `clientName()` gives it. Without one, the cell says nothing is there. */
    name: string | undefined;
    online: boolean;
}

/**
 * A client named in someone else's list: the dot says whether it is connected, the name
 * which one it is. This stood in three lists as three copies of the same few lines, and a
 * fourth list named its clients without the dot at all.
 */
export const ClientLabel = ({ name, online }: ClientLabelProps) => {
    if (name === undefined) return <span className="text-text-muted text-sm">{EMPTY_VALUE}</span>;
    return (
        <div className="flex items-center gap-2">
            <StatusDot tone={online ? "success" : "neutral"} />
            <span className="text-sm">{name}</span>
        </div>
    );
};
