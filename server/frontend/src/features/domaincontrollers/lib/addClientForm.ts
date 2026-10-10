/** What the add-client flow collects as text, in either branch. */
export interface AddClientInput {
    displayName: string;
    restrictIp: boolean;
    allowedIp: string;
    hostname: string;
    targetAddress: string;
    registrationSecret: string;
}

/**
 * Whether leaving the flow now would throw something away. The connection mode alone does
 * not count: it is one click to choose again. A field of the branch that is not on screen
 * does -- going back to it finds the value still there, so it is not gone yet.
 */
export function hasAddClientInput(input: AddClientInput): boolean {
    return (
        input.restrictIp ||
        [input.displayName, input.allowedIp, input.hostname, input.targetAddress, input.registrationSecret].some(
            (value) => value.trim() !== "",
        )
    );
}
