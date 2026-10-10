import { DEFAULT_AGENT_PORT } from "@sadm/shared";
import { Input } from "@stefgo/react-ui-components";
import { AddClientForm } from "../useAddClientForm";

/**
 * Where the server dials and what it authenticates with. Unlike the inbound branch this
 * step has an effect the moment it finishes: the server registers itself with the agent and
 * opens the session, and the client is stored only if that works.
 */
export const StepOutboundDetails = ({ form }: { form: AddClientForm }) => (
    <div className="space-y-6">
        <p className="text-sm text-text-muted">
            The server connects to the agent and registers it with the setup PIN the agent
            prints to its log on startup, e.g.{" "}
            <code className="bg-hover px-1 rounded">docker logs sadm-client</code>. Each PIN
            registers once.
        </p>

        <Input
            label="Hostname (optional)"
            value={form.hostname}
            onChange={(e) => form.setHostname(e.target.value)}
            placeholder="dc1"
            hint="Display name — defaults to the target address if left empty."
        />

        <Input
            label="Target Address"
            value={form.targetAddress}
            onChange={(e) => form.setTargetAddress(e.target.value)}
            onBlur={() => form.touch("targetAddress")}
            placeholder={`192.168.1.100:${DEFAULT_AGENT_PORT}`}
            error={
                form.targetAddressInvalid
                    ? "Enter a host or host:port, without scheme, path or credentials."
                    : form.missing.targetAddress
                      ? "Enter a target address"
                      : undefined
            }
            hint={`Host and port of the agent's web server. Without a port, :${DEFAULT_AGENT_PORT} is used.`}
            required
        />

        <Input
            label="Setup PIN"
            value={form.registrationSecret}
            onChange={(e) => form.setRegistrationSecret(e.target.value)}
            onBlur={() => form.touch("registrationSecret")}
            error={form.missing.registrationSecret ? "Enter the setup PIN" : undefined}
            placeholder="K7QM-3XRD"
            hint="From the agent's log — or the value of SADM_REGISTRATION_SECRET, if the agent was given one."
            required
        />
    </div>
);
