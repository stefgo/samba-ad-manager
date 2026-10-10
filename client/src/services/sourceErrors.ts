/** What could not be read in one measurement, as the report names it. */
export interface SourceError {
    source: string;
    message: string;
}

export interface SourceErrorChange {
    /** Could not be read now, and either could before or failed for another reason. */
    failed: SourceError[];
    /** Could not be read before and can now. */
    recovered: string[];
}

/**
 * What changed between two measurements in what could not be read. A source that stays
 * unreadable for the same reason is in neither list: it is measured once a minute, and the
 * log should say that it broke and that it came back, not repeat it in between.
 */
export function sourceErrorChange(previous: readonly SourceError[], current: readonly SourceError[]): SourceErrorChange {
    const before = new Map(previous.map((error) => [error.source, error.message]));
    const now = new Set(current.map((error) => error.source));
    return {
        failed: current.filter((error) => before.get(error.source) !== error.message),
        recovered: previous.map((error) => error.source).filter((source) => !now.has(source)),
    };
}
