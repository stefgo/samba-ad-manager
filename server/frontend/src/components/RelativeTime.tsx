import { useNow } from "../hooks/useNow";
import { formatDate, formatRelative, toTimestamp } from "../utils";

interface RelativeTimeProps {
    date: Date | string | number | null | undefined;
    /** Seconds in the tooltip, where several things happen within one minute. */
    seconds?: boolean;
    className?: string;
}

/**
 * When something happened, as the distance from now, with the date itself in the tooltip.
 * It moves on with the page's one clock (`useNow`), so "5 min ago" does not stand still
 * until something else re-renders the row.
 */
export const RelativeTime = ({ date, seconds, className }: RelativeTimeProps) => {
    const now = useNow();
    const at = toTimestamp(date);
    if (at === null) return <span className={className}>{formatRelative(null, now)}</span>;
    return (
        <time dateTime={new Date(at).toISOString()} title={formatDate(at, { seconds })} className={className}>
            {formatRelative(at, now)}
        </time>
    );
};
