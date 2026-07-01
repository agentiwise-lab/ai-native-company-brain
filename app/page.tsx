import { BrainCommandCenter } from "@/app/brain-command-center";
import { OnboardingChatSetup } from "@/app/onboarding-chat-setup";
import { bootstrapTenantFromForm } from "@/app/setup/actions";
import { composioControlPlane } from "@/lib/composio-control-plane";
import { composioIngestionPipeline } from "@/lib/composio-ingestion";
import { repository } from "@/lib/repository";
import { getSetupState } from "@/lib/setup";

export const dynamic = "force-dynamic";

function SetupShell() {
  return (
    <main className="setupCanvas">
      <form action={bootstrapTenantFromForm}>
        <OnboardingChatSetup />
      </form>
    </main>
  );
}

export default async function Home() {
  const setup = getSetupState();

  if (!setup.isComplete) {
    return <SetupShell />;
  }

  const [snapshot, composio, ingestion] = await Promise.all([
    repository.dashboard(),
    composioControlPlane.getState(),
    composioIngestionPipeline.getState()
  ]);

  return (
    <BrainCommandCenter
      setup={setup}
      snapshot={snapshot}
      connectorCounts={{
        accounts: composio.connectedAccounts.length,
        artifacts: ingestion.artifacts.length
      }}
    />
  );
}
