import { DOCS } from "../../../../../lib/docs";

/**
 * What the token is and where it goes. There is nothing to enter: the domain controller
 * names the agent, and the agent says of itself what else there is to know.
 */
export const StepInboundDetails = ({ dcName }: { dcName: string }) => (
    <div className="space-y-4 text-sm text-text-muted">
        <p>
            The server issues a registration token for {dcName}. Start the domain controller's container with this
            server's address as <span className="font-mono text-text-primary">SADM_SERVER_URL</span> and the token as{" "}
            <span className="font-mono text-text-primary">SADM_REGISTRATION_TOKEN</span>: the agent registers when it
            starts and connects from then on.
        </p>
        <p>
            The token is shown once. It is good for {dcName} only, for one registration and for an hour, and takes
            the place of any issued for this domain controller before.{" "}
            <a href={DOCS.agent} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                How to set it up
            </a>
        </p>
    </div>
);
