import { composioControlPlane, type ComposioState } from "./composio-control-plane";
import { composioIngestionPipeline, type ComposioIngestionState, type NormalizedComposioArtifact } from "./composio-ingestion";

type ControlPlaneLike = {
  getState(): Promise<ComposioState>;
};

type IngestionPipelineLike = typeof composioIngestionPipeline;

type ConnectorOpsOptions = {
  controlPlane?: ControlPlaneLike;
  ingestionPipeline?: IngestionPipelineLike;
  now?: () => string;
};

type ReplayInput = {
  connector: string;
  connectedAccountId: string;
  sourceObjectId: string;
};

function retryGuidance() {
  return "Check connector permissions, source scope, checkpoint cursor, and connected-account status before retrying.";
}

function secondsBetween(left: string, right: string) {
  const diff = new Date(right).getTime() - new Date(left).getTime();
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff / 1000)) : 0;
}

function latestByCreatedAt<T extends { createdAt?: string; startedAt?: string; updatedAt?: string }>(items: T[]) {
  return [...items].sort((a, b) => String(b.createdAt ?? b.startedAt ?? b.updatedAt).localeCompare(String(a.createdAt ?? a.startedAt ?? a.updatedAt)))[0];
}

function connectorsFromState(control: ComposioState, ingestion: ComposioIngestionState) {
  const keys = new Set<string>();
  for (const account of control.connectedAccounts) {
    keys.add(`${account.toolkitSlug}:${account.id}`);
  }
  for (const checkpoint of ingestion.checkpoints) {
    keys.add(`${checkpoint.connector}:${checkpoint.connectedAccountId}`);
  }
  for (const run of ingestion.runs) {
    keys.add(`${run.connector}:${run.connectedAccountId}`);
  }
  for (const artifact of ingestion.artifacts) {
    keys.add(`${artifact.connector}:${artifact.connectedAccountId}`);
  }
  return [...keys].map((key) => {
    const [connector, connectedAccountId] = key.split(":");
    return { connector, connectedAccountId };
  });
}

function safeError(run: ComposioIngestionState["runs"][number]) {
  return {
    id: run.id,
    status: run.status,
    connector: run.connector,
    connectedAccountId: run.connectedAccountId,
    sourceObjectId: run.sourceObjectId,
    message: run.message,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    guidance: retryGuidance()
  };
}

function replayInputFromArtifact(
  artifact: NormalizedComposioArtifact,
  account: ComposioState["connectedAccounts"][number],
  checkpoint?: ComposioIngestionState["checkpoints"][number]
) {
  return {
    connector: artifact.connector,
    sourceType: artifact.source.sourceType,
    sourceObjectId: artifact.sourceObjectId,
    sourceUpdatedAt: artifact.source.capturedAt,
    principalId: artifact.principalId,
    connectedAccount: {
      id: account.id,
      status: account.status,
      principalId: account.principalId
    },
    provenanceUrl: artifact.provenanceUrl,
    title: artifact.source.title,
    normalizedText: artifact.normalizedText,
    raw: artifact.raw,
    acl: artifact.acl,
    checkpoint: {
      cursor: checkpoint?.cursor
    }
  };
}

export function createConnectorOps(options: ConnectorOpsOptions = {}) {
  const controlPlane = options.controlPlane ?? composioControlPlane;
  const ingestionPipeline = options.ingestionPipeline ?? composioIngestionPipeline;
  const now = options.now ?? (() => new Date().toISOString());

  async function load() {
    const [control, ingestion] = await Promise.all([controlPlane.getState(), ingestionPipeline.getState()]);
    return { control, ingestion };
  }

  function findAccount(control: ComposioState, connectedAccountId: string) {
    const account = control.connectedAccounts.find((candidate) => candidate.id === connectedAccountId);
    if (!account) {
      throw new Error(`Connected account ${connectedAccountId} was not found.`);
    }
    return account;
  }

  function assertAccountActive(control: ComposioState, connectedAccountId: string) {
    const account = findAccount(control, connectedAccountId);
    if (account.status === "revoked") {
      throw new Error(`Connected account ${connectedAccountId} is revoked.`);
    }
    if (account.status !== "active") {
      throw new Error(`Connected account ${connectedAccountId} is not active.`);
    }
    return account;
  }

  return {
    async assertConnectedAccountUsable(connectedAccountId: string) {
      const { control } = await load();
      return assertAccountActive(control, connectedAccountId);
    },

    async health() {
      const { control, ingestion } = await load();
      const timestamp = now();
      const connectors = connectorsFromState(control, ingestion).map(({ connector, connectedAccountId }) => {
        const account = control.connectedAccounts.find((candidate) => candidate.id === connectedAccountId);
        const checkpoint = ingestion.checkpoints.find(
          (candidate) => candidate.connector === connector && candidate.connectedAccountId === connectedAccountId
        );
        const runs = ingestion.runs.filter((run) => run.connector === connector && run.connectedAccountId === connectedAccountId);
        const latestRun = latestByCreatedAt(runs);
        const artifacts = ingestion.artifacts.filter(
          (artifact) => artifact.connector === connector && artifact.connectedAccountId === connectedAccountId
        );

        return {
          connector,
          connectedAccountId,
          accountStatus: account?.status ?? "missing",
          toolkitSlug: account?.toolkitSlug ?? connector,
          lastCheckpoint: checkpoint,
          lagSeconds: checkpoint ? secondsBetween(checkpoint.updatedAt, timestamp) : null,
          latestRun,
          artifactCount: artifacts.length,
          recentErrors: runs.filter((run) => run.status === "failed").slice(0, 5).map(safeError),
          revokedAt: account?.revokedAt
        };
      });

      return { generatedAt: timestamp, connectors };
    },

    async replay(input: ReplayInput) {
      const { control, ingestion } = await load();
      const account = assertAccountActive(control, input.connectedAccountId);
      const artifact = ingestion.artifacts.find(
        (candidate) =>
          candidate.connector === input.connector &&
          candidate.connectedAccountId === input.connectedAccountId &&
          candidate.sourceObjectId === input.sourceObjectId
      );
      if (!artifact) {
        throw new Error(`Artifact ${input.sourceObjectId} was not found for ${input.connector}.`);
      }
      const checkpoint = ingestion.checkpoints.find(
        (candidate) => candidate.connector === input.connector && candidate.connectedAccountId === input.connectedAccountId
      );
      return ingestionPipeline.ingestComposioResult(replayInputFromArtifact(artifact, account, checkpoint));
    }
  };
}

export const connectorOps = createConnectorOps();
