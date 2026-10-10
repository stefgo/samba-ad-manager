import { useState } from "react";
import { CONNECTION_MODE, ConnectionMode, Ipv4OrCidrSchema, normaliseTargetAddress } from "@sadm/shared";
import { hasAddClientInput } from "../../lib/addClientForm";

/**
 * Everything the add-client flow collects, held above the wizard.
 *
 * The wizard renders only the current step, so a step that kept its inputs in its own
 * `useState` would lose them the moment the user went back. Holding the values here makes
 * Back and Next free.
 */
/** The required fields, which say they are empty once they have been left empty. */
export type RequiredField = "allowedIp" | "targetAddress" | "registrationSecret";

export interface AddClientForm {
    mode: ConnectionMode;
    setMode: (mode: ConnectionMode) => void;

    /** Inbound: what the issued token fixes for the client it will create. */
    displayName: string;
    setDisplayName: (value: string) => void;
    restrictIp: boolean;
    setRestrictIp: (value: boolean) => void;
    allowedIp: string;
    setAllowedIp: (value: string) => void;
    allowedIpInvalid: boolean;

    /**
     * Outbound: where the server dials, and what it authenticates with -- the agent's setup
     * PIN or its `SADM_REGISTRATION_SECRET`, sent as `registrationSecret` either way.
     */
    hostname: string;
    setHostname: (value: string) => void;
    targetAddress: string;
    setTargetAddress: (value: string) => void;
    targetAddressInvalid: boolean;
    registrationSecret: string;
    setRegistrationSecret: (value: string) => void;

    /** Marks a required field as left, from its `onBlur`. */
    touch: (field: RequiredField) => void;
    /** Required fields that have been left empty -- not merely not filled in yet. */
    missing: Record<RequiredField, boolean>;

    /** Whether the details step holds enough to go on. */
    canContinue: boolean;
    /** Whether anything has been entered that leaving would throw away. */
    isDirty: boolean;
}

export function useAddClientForm(): AddClientForm {
    const [mode, setMode] = useState<ConnectionMode>(CONNECTION_MODE.INBOUND);

    const [displayName, setDisplayName] = useState("");
    const [restrictIp, setRestrictIp] = useState(false);
    const [allowedIp, setAllowedIp] = useState("");

    const [hostname, setHostname] = useState("");
    const [targetAddress, setTargetAddress] = useState("");
    const [registrationSecret, setRegistrationSecret] = useState("");

    // Held here rather than in the steps, like the values: going back and forth keeps them.
    const [touched, setTouched] = useState<ReadonlySet<RequiredField>>(() => new Set());
    const touch = (field: RequiredField) => {
        if (!touched.has(field)) setTouched(new Set(touched).add(field));
    };

    // The same rules the endpoints apply, from the same schemas, so a value is refused in
    // the field rather than after a round trip.
    const allowedIpTrimmed = allowedIp.trim();
    const allowedIpInvalid =
        restrictIp &&
        allowedIpTrimmed.length > 0 &&
        !Ipv4OrCidrSchema.safeParse(allowedIpTrimmed).success;

    const targetAddressTrimmed = targetAddress.trim();
    const targetAddressInvalid =
        targetAddressTrimmed.length > 0 &&
        normaliseTargetAddress(targetAddressTrimmed) === null;

    const missing: Record<RequiredField, boolean> = {
        allowedIp: touched.has("allowedIp") && allowedIpTrimmed.length === 0,
        targetAddress: touched.has("targetAddress") && targetAddressTrimmed.length === 0,
        registrationSecret: touched.has("registrationSecret") && registrationSecret.trim().length === 0,
    };

    const canContinue =
        mode === CONNECTION_MODE.INBOUND
            ? !allowedIpInvalid && (!restrictIp || allowedIpTrimmed.length > 0)
            : !targetAddressInvalid &&
              targetAddressTrimmed.length > 0 &&
              registrationSecret.trim().length > 0;

    return {
        mode,
        setMode,
        displayName,
        setDisplayName,
        restrictIp,
        setRestrictIp,
        allowedIp,
        setAllowedIp,
        allowedIpInvalid,
        hostname,
        setHostname,
        targetAddress,
        setTargetAddress,
        targetAddressInvalid,
        registrationSecret,
        setRegistrationSecret,
        touch,
        missing,
        canContinue,
        isDirty: hasAddClientInput({ displayName, restrictIp, allowedIp, hostname, targetAddress, registrationSecret }),
    };
}
