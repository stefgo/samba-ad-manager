import { Checkbox, Input } from "@stefgo/react-ui-components";
import { AddClientForm } from "../useAddClientForm";

/**
 * What the token fixes for the client it will create. Both fields are optional: without
 * them the agent's hostname names the client and the address it registers from becomes its
 * allowed address, which is what every token did before they existed.
 */
export const StepInboundDetails = ({ form }: { form: AddClientForm }) => (
    <div className="space-y-6">
        <p className="text-sm text-text-muted">
            The token carries what the agent cannot tell the server about itself. Leave a
            field empty to decide it at registration time instead.
        </p>

        <Input
            label="Display Name (optional)"
            value={form.displayName}
            onChange={(e) => form.setDisplayName(e.target.value)}
            placeholder="dc1"
            hint="Leave empty to use the hostname the agent reports."
        />

        <div className="space-y-4">
            <Checkbox
                label="Restrict connections to an IP address or network"
                checked={form.restrictIp}
                onChange={(e) => form.setRestrictIp(e.target.checked)}
            />
            <p className="text-xs text-text-muted -mt-2 ml-6">
                {form.restrictIp
                    ? "The agent is refused when it connects from anywhere else."
                    : "The agent is bound to the address it registers from. You can widen that to a network or switch the check off later in the editor."}
            </p>

            {form.restrictIp && (
                <Input
                    label="Allowed IP or Network"
                    value={form.allowedIp}
                    onChange={(e) => form.setAllowedIp(e.target.value)}
                    onBlur={() => form.touch("allowedIp")}
                    placeholder="192.168.1.50 or 192.168.1.0/24"
                    error={
                        form.allowedIpInvalid
                            ? "Enter an IPv4 address or an IPv4 network in CIDR notation."
                            : form.missing.allowedIp
                              ? "Enter an IP address or network"
                              : undefined
                    }
                    hint="Set this when you already know where the agent will sit."
                    required
                />
            )}
        </div>
    </div>
);
