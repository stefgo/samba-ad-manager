/** What of a key press the rule looks at; a `KeyboardEvent` fits. */
export interface HotkeyPress {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
}

/** What of the element the key was pressed in the rule looks at; an `Element` fits. */
export interface HotkeyTarget {
    tagName?: string;
    isContentEditable?: boolean;
}

/** Elements a key press is text for, not a command. */
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Whether a key press asks for the search of the list on screen: a bare `/`, pressed
 * anywhere but in a field. In a field the slash is a character -- a network in CIDR notation
 * has one -- and with a modifier it is somebody else's shortcut.
 */
export function isSearchHotkey(press: HotkeyPress, target: HotkeyTarget | null): boolean {
    if (press.key !== "/" || press.ctrlKey || press.metaKey || press.altKey) return false;
    if (!target) return true;
    return !target.isContentEditable && !TYPING_TAGS.has(target.tagName?.toUpperCase() ?? "");
}
