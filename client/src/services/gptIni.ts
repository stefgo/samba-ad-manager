/**
 * A group policy's folder in the sysvol holds a `GPT.INI` that says which version of the
 * policy the folder is:
 *
 *     [General]
 *     Version=65539
 *
 * The number is the one the directory keeps as `versionNumber` on the policy's object, and
 * the two differ when the sysvol of this domain controller has not been brought up to date.
 */

/** The folder of one policy: its GUID in braces. */
const GPO_FOLDER = /^\{([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}$/i;

/** The policy's GUID, lower case and without braces, or null for a folder that is none. */
export function gpoGuidOfFolder(name: string): string | null {
    const match = GPO_FOLDER.exec(name);
    return match ? match[1].toLowerCase() : null;
}

/**
 * `Version` of the `[General]` section, or null where the file names none. Windows writes
 * the file with CRLF and sometimes with a byte order mark; keys are not case sensitive.
 */
export function gptIniVersion(text: string): number | null {
    let section = "";
    for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith(";")) continue;
        const header = /^\[(.+)\]$/.exec(line);
        if (header) {
            section = header[1].trim().toLowerCase();
            continue;
        }
        const pair = /^([^=]+)=(.*)$/.exec(line);
        if (!pair || section !== "general" || pair[1].trim().toLowerCase() !== "version") continue;
        const value = pair[2].trim();
        return /^\d+$/.test(value) ? Number(value) : null;
    }
    return null;
}
