import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrainEvent, Principal, SourceArtifact } from "./types";

type ConnectedAccountSnapshot = {
  id: string;
  status: "pending" | "active" | "revoked" | "errored";
  principalId: string;
};

export type ComposioIngestionInput = {
  connector: string;
  sourceType: SourceArtifact["sourceType"];
  sourceObjectId: string;
  sourceUpdatedAt?: string;
  principalId: string;
  connectedAccount: ConnectedAccountSnapshot;
  provenanceUrl: string;
  title: string;
  normalizedText: string;
  raw: Record<string, unknown>;
  acl: {
    teams: string[];
    roles: Principal["role"][];
    sensitivity: SourceArtifact["sensitivity"];
  };
  checkpoint?: {
    cursor?: string;
  };
};

export type NormalizedComposioArtifact = {
  id: string;
  tenantId: string;
  connector: string;
  sourceObjectId: string;
  connectedAccountId: string;
  principalId: string;
  provenanceUrl: string;
  rawObjectKey: string;
  raw: Record<string, unknown>;
  normalizedText: string;
  acl: ComposioIngestionInput["acl"];
  checksum: string;
  source: SourceArtifact;
  createdAt: string;
  updatedAt: string;
};

export type ComposioCheckpoint = {
  id: string;
  connector: string;
  connectedAccountId: string;
  cursor?: string;
  lastSourceObjectId: string;
  updatedAt: string;
};

export type ComposioIngestionRun = {
  id: string;
  connector: string;
  connectedAccountId: string;
  sourceObjectId?: string;
  status: "created" | "updated" | "duplicate" | "failed";
  message: string;
  startedAt: string;
  finishedAt: string;
};

export type ComposioIngestionState = {
  artifacts: NormalizedComposioArtifact[];
  checkpoints: ComposioCheckpoint[];
  runs: ComposioIngestionRun[];
  auditEvents: BrainEvent[];
};

export type ComposioIngestionStore = {
  read(): Promise<ComposioIngestionState | null>;
  write(state: ComposioIngestionState): Promise<void>;
};

type PipelineOptions = {
  store?: ComposioIngestionStore;
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

function defaultState(): ComposioIngestionState {
  return {
    artifacts: [],
    checkpoints: [],
    runs: [],
    auditEvents: []
  };
}

function defaultStatePath() {
  return process.env.COMPOSIO_INGESTION_STATE_PATH ?? join(process.cwd(), "data", "composio-ingestion-state.json");
}

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function slug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function checksumFor(input: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
}

function createFileStore(path = defaultStatePath()): ComposioIngestionStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as ComposioIngestionState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

export function createComposioIngestionPipeline(options: PipelineOptions = {}) {
  const store = options.store ?? createFileStore();
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? createId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: ComposioIngestionState) {
    await store.write(state);
  }

  function upsertCheckpoint(state: ComposioIngestionState, input: ComposioIngestionInput) {
    const checkpointId = `${input.connector}:${input.connectedAccount.id}`;
    const checkpoint: ComposioCheckpoint = {
      id: checkpointId,
      connector: input.connector,
      connectedAccountId: input.connectedAccount.id,
      cursor: input.checkpoint?.cursor,
      lastSourceObjectId: input.sourceObjectId,
      updatedAt: now()
    };
    state.checkpoints = [checkpoint, ...state.checkpoints.filter((candidate) => candidate.id !== checkpointId)];
  }

  function buildArtifact(input: ComposioIngestionInput, checksum: string, existing?: NormalizedComposioArtifact): NormalizedComposioArtifact {
    const timestamp = now();
    const artifactId = existing?.id ?? `src_composio_${slug(input.connector)}_${createHash("sha1").update(input.sourceObjectId).digest("hex").slice(0, 10)}`;
    const rawObjectKey = `composio/${slug(input.connector)}/${encodeURIComponent(input.sourceObjectId)}/${checksum}.json`;

    return {
      id: artifactId,
      tenantId,
      connector: input.connector,
      sourceObjectId: input.sourceObjectId,
      connectedAccountId: input.connectedAccount.id,
      principalId: input.principalId,
      provenanceUrl: input.provenanceUrl,
      rawObjectKey,
      raw: input.raw,
      normalizedText: input.normalizedText,
      acl: input.acl,
      checksum,
      source: {
        id: artifactId,
        tenantId,
        sourceType: input.sourceType,
        title: input.title,
        uri: input.provenanceUrl,
        ownerId: input.principalId,
        tier: "team",
        sensitivity: input.acl.sensitivity,
        capturedAt: input.sourceUpdatedAt ?? timestamp,
        checksum
      },
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
  }

  function addAuditEvent(state: ComposioIngestionState, artifact: NormalizedComposioArtifact, actorId: string) {
    state.auditEvents.unshift({
      id: id("evt_ingest"),
      tenantId,
      actorId,
      action: "ingest",
      targetId: artifact.id,
      targetType: "artifact",
      policyDecision: "allow",
      metadata: {
        connector: artifact.connector,
        sourceObjectId: artifact.sourceObjectId,
        connectedAccountId: artifact.connectedAccountId,
        sensitivity: artifact.acl.sensitivity,
        rawObjectKey: artifact.rawObjectKey
      },
      createdAt: now()
    });
  }

  async function recordFailedRun(state: ComposioIngestionState, input: ComposioIngestionInput, error: unknown, startedAt: string) {
    state.runs.unshift({
      id: id("run_ingest"),
      connector: input.connector,
      connectedAccountId: input.connectedAccount.id,
      sourceObjectId: input.sourceObjectId || undefined,
      status: "failed",
      message: error instanceof Error ? error.message : "Composio ingestion failed.",
      startedAt,
      finishedAt: now()
    });
    await save(state);
  }

  return {
    async getState() {
      return load();
    },

    async ingestComposioResult(input: ComposioIngestionInput) {
      const state = await load();
      const startedAt = now();

      try {
        if (input.connectedAccount.status === "revoked") {
          throw new Error(`Connected account ${input.connectedAccount.id} is revoked.`);
        }
        if (!input.sourceObjectId.trim()) {
          throw new Error("Composio source object id is required.");
        }
        if (!input.normalizedText.trim()) {
          throw new Error("Normalized text is required.");
        }

        const checksum = checksumFor({
          raw: input.raw,
          normalizedText: input.normalizedText,
          acl: input.acl,
          provenanceUrl: input.provenanceUrl
        });
        const existing = state.artifacts.find(
          (artifact) =>
            artifact.connector === input.connector &&
            artifact.connectedAccountId === input.connectedAccount.id &&
            artifact.sourceObjectId === input.sourceObjectId
        );
        const status: ComposioIngestionRun["status"] = existing ? (existing.checksum === checksum ? "duplicate" : "updated") : "created";
        const artifact = status === "duplicate" && existing ? existing : buildArtifact(input, checksum, existing);

        if (status !== "duplicate") {
          state.artifacts = [artifact, ...state.artifacts.filter((candidate) => candidate.id !== artifact.id)];
          addAuditEvent(state, artifact, input.principalId);
        }

        upsertCheckpoint(state, input);
        state.runs.unshift({
          id: id("run_ingest"),
          connector: input.connector,
          connectedAccountId: input.connectedAccount.id,
          sourceObjectId: input.sourceObjectId,
          status,
          message: status === "duplicate" ? "Duplicate source object skipped." : `Artifact ${status}.`,
          startedAt,
          finishedAt: now()
        });
        await save(state);

        return { status, artifact };
      } catch (error) {
        await recordFailedRun(state, input, error, startedAt);
        throw error;
      }
    }
  };
}

export const composioIngestionPipeline = createComposioIngestionPipeline();
