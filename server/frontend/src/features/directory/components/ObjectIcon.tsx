import { Box, Building2, Folder, FolderTree, Monitor, User, Users, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
    user: User,
    group: Users,
    computer: Monitor,
    ou: FolderTree,
    container: Folder,
    builtin: Folder,
    domain: Building2,
};

/** The icon of a kind of directory object; a plain box for a kind this application has no word for. */
export const ObjectIcon = ({ type, size = 16, className }: { type: string; size?: number; className?: string }) => {
    const Icon = ICONS[type] ?? Box;
    return <Icon size={size} className={className ?? "shrink-0 text-text-muted"} aria-hidden />;
};
