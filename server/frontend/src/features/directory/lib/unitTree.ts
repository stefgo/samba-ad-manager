import type { DirectoryContainer } from "@sadm/shared";

/** A container with how deep it stands below the domain. */
export interface UnitNode extends DirectoryContainer {
    depth: number;
    hasChildren: boolean;
}

/**
 * The containers as a tree written top to bottom: every container directly above its own,
 * siblings by name. The agent sends them flat with their parent's DN; a container whose
 * parent is not among them -- an OU inside a container that is hidden -- hangs below the
 * domain, so nothing that can hold objects goes missing from a picker.
 */
export function orderUnits(containers: readonly DirectoryContainer[]): UnitNode[] {
    const byDn = new Map(containers.map((container) => [container.dn.toLowerCase(), container]));
    const root = containers.find((container) => container.parentDn === null) ?? null;
    const children = new Map<string, DirectoryContainer[]>();
    for (const container of containers) {
        if (container === root) continue;
        const parent = container.parentDn?.toLowerCase() ?? "";
        const key = byDn.has(parent) ? parent : (root?.dn.toLowerCase() ?? "");
        children.set(key, [...(children.get(key) ?? []), container]);
    }

    const ordered: UnitNode[] = [];
    const walk = (container: DirectoryContainer, depth: number) => {
        const below = [...(children.get(container.dn.toLowerCase()) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
        ordered.push({ ...container, depth, hasChildren: below.length > 0 });
        for (const child of below) walk(child, depth + 1);
    };
    if (root) {
        walk(root, 0);
    } else {
        for (const container of [...(children.get("") ?? [])].sort((a, b) => a.name.localeCompare(b.name))) walk(container, 0);
    }
    return ordered;
}

/** The way from the domain down to a container, by name: `sadm.test / Staff / Sales`. */
export function unitTrail(units: readonly UnitNode[], dn: string): string {
    const byDn = new Map(units.map((unit) => [unit.dn.toLowerCase(), unit]));
    const names: string[] = [];
    let current = byDn.get(dn.toLowerCase());
    // The depth bounds the walk: a parent that pointed back down would otherwise never end it.
    for (let i = 0; current && i < 64; i++) {
        names.unshift(current.name);
        current = current.parentDn ? byDn.get(current.parentDn.toLowerCase()) : undefined;
    }
    return names.length > 0 ? names.join(" / ") : dn;
}

/** A container's label in a picker: indented by its depth, so the list reads as the tree it is. */
export const unitOptionLabel = (unit: UnitNode): string => `${"   ".repeat(unit.depth)}${unit.name}`;
