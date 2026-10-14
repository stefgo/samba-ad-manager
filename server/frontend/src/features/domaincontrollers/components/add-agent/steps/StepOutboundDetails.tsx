import { Input } from "@stefgo/react-ui-components";
import type { EntityForm } from "../../../../../hooks/useEntityForm";
import type { ConnectAgentDraft } from "../../../lib/agentForm";

/**
 * Where the server dials and what it authenticates with. Unlike the inbound branch this
 * step has an effect the moment it finishes: the server registers the agent and opens the
 * connection, and the agent is kept only if that works.
 */
export const StepOutboundDetails = ({ form }: { form: EntityForm<ConnectAgentDraft, unknown> }) => (
    <div className="space-y-6">
        <p className="text-sm text-text-muted">
            The server connects to the agent and registers it with the setup PIN the agent prints into its log when
            it starts without <span className="font-mono text-text-primary">SADM_SERVER_URL</span>. Each PIN
            registers once.
        </p>

        <Input
            label="Agent Address"
            value={form.draft.targetAddress}
            onChange={(event) => form.set("targetAddress", event.target.value)}
            error={form.errors.targetAddress}
            hint="Host and port the agent listens on. Write wss://host:port for an agent that serves TLS."
            required
        />

        <Input
            label="Setup PIN"
            value={form.draft.registrationSecret}
            onChange={(event) => form.set("registrationSecret", event.target.value)}
            error={form.errors.registrationSecret}
            hint="From the agent's log — or the value of SADM_REGISTRATION_SECRET, if the agent was given one."
            autoComplete="off"
            autoFocus
            required
        />
    </div>
);
