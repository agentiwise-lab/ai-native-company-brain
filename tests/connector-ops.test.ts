import { describe, expect, it } from "vitest";
import type { ComposioState } from "../lib/composio-control-plane";
import { createComposioIngestionPipeline, type ComposioIngestionState, type ComposioIngestionStore } from "../lib/composio-ingestion";
import { createConnectorOps } from "../lib/connector-ops";

function createMemoryStore(initial?: Partial<ComposioIngestionState>) {
  let state: ComposioIngestionState | null = initial
    ? {
        artifacts: [],
        checkpoints: [],
        runs: [],
        auditEvents: [],
        ...initial
      }
    : null;

  const store: ComposioIngestionStore & { snapshot: () => ComposioIngestionState | null } = {
    async read() {
      return state;
    },
    async write(next) {
      state = next;
    },
    snapshot() {
      return state;
    }
  };

  return store;
}

function controlState(status: "active" | "revoked" = "active"): ComposioState {
  return {
    config: {
      projectId: "proj_123",
      baseUrl: "https://backend.composio.dev",
      apiKeyConfigured: true,
      apiKeyRef: "COMPOSIO_API_KEY",
      authConfigCount: 1,
      validatedAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z"
    },
    connectedAccounts: [
      {
        id: "acct_slack",
        toolkitSlug: "slack",
        authConfigId: "auth_slack",
        principalId: "usr_admin",
        status,
        revokedAt: status === "revoked" ? "2026-06-29T12:00:00.000Z" : undefined,
        createdAt: "2026-06-29T10:00:00.000Z",
        updatedAt: "2026-06-29T12:00:00.000Z"
      }
    ],
    sessions: [],
    registryCandidates: [],
    auditEvents: status === "revoked"
      ? [
          {
            id: "evt_revoke",
            action: "composio.account.revoked",
            targetId: "acct_slack",
            metadata: { status: "revoked" },
            createdAt: "2026-06-29T12:00:00.000Z"
          }
        ]
      : []
  };
}

async function seedSlackArtifact(status: "active" | "revoked" = "active") {
  const store = createMemoryStore();
  const pipeline = createComposioIngestionPipeline({ store, now: () => "2026-06-29T12:00:00.000Z" });
  await pipeline.ingestComposioResult({
    connector: "slack",
    sourceType: "slack",
    sourceObjectId: "slack:T123:C123:1719600100.000000",
    sourceUpdatedAt: "2026-06-29T11:30:00.000Z",
    principalId: "usr_admin",
    connectedAccount: {
      id: "acct_slack",
      status,
      principalId: "usr_admin"
    },
    provenanceUrl: "https://slack.com/archives/C123/p1719600100000000",
    title: "Slack #customer-handoffs thread",
    normalizedText: "Customer handoff details.",
    raw: { text: "Customer handoff details." },
    acl: {
      teams: ["platform"],
      roles: ["admin", "reviewer", "operator", "agent"],
      sensitivity: "internal"
    },
    checkpoint: { cursor: "cursor_1" }
  });
  return { store, pipeline };
}

describe("connector operations", () => {
  it("builds a connector health dashboard with checkpoint, lag, latest run, and account status", async () => {
    const { pipeline } = await seedSlackArtifact();
    const ops = createConnectorOps({
      controlPlane: { getState: async () => controlState() },
      ingestionPipeline: pipeline,
      now: () => "2026-06-29T14:00:00.000Z"
    });

    const health = await ops.health();

    expect(health.connectors[0]).toMatchObject({
      connector: "slack",
      connectedAccountId: "acct_slack",
      accountStatus: "active",
      lastCheckpoint: {
        cursor: "cursor_1"
      },
      latestRun: {
        status: "created"
      }
    });
    expect(health.connectors[0].lagSeconds).toBe(7200);
  });

  it("replays an existing artifact idempotently without duplicating artifacts", async () => {
    const { store, pipeline } = await seedSlackArtifact();
    const ops = createConnectorOps({
      controlPlane: { getState: async () => controlState() },
      ingestionPipeline: pipeline
    });

    const replay = await ops.replay({
      connector: "slack",
      connectedAccountId: "acct_slack",
      sourceObjectId: "slack:T123:C123:1719600100.000000"
    });

    expect(replay.status).toBe("duplicate");
    expect(store.snapshot()?.artifacts).toHaveLength(1);
    expect(store.snapshot()?.checkpoints[0].cursor).toBe("cursor_1");
  });

  it("blocks replay and tool execution checks for revoked connected accounts", async () => {
    const { pipeline } = await seedSlackArtifact();
    const ops = createConnectorOps({
      controlPlane: { getState: async () => controlState("revoked") },
      ingestionPipeline: pipeline
    });

    await expect(
      ops.replay({
        connector: "slack",
        connectedAccountId: "acct_slack",
        sourceObjectId: "slack:T123:C123:1719600100.000000"
      })
    ).rejects.toThrow(/revoked/i);
    await expect(ops.assertConnectedAccountUsable("acct_slack")).rejects.toThrow(/revoked/i);
  });

  it("keeps checkpoint visibility after replay", async () => {
    const { pipeline } = await seedSlackArtifact();
    const ops = createConnectorOps({
      controlPlane: { getState: async () => controlState() },
      ingestionPipeline: pipeline
    });

    await ops.replay({
      connector: "slack",
      connectedAccountId: "acct_slack",
      sourceObjectId: "slack:T123:C123:1719600100.000000"
    });
    const health = await ops.health();

    expect(health.connectors[0].lastCheckpoint).toMatchObject({
      id: "slack:acct_slack",
      lastSourceObjectId: "slack:T123:C123:1719600100.000000"
    });
  });

  it("surfaces failed sync runs with safe retry guidance", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store, now: () => "2026-06-29T12:00:00.000Z" });
    await expect(
      pipeline.ingestComposioResult({
        connector: "slack",
        sourceType: "slack",
        sourceObjectId: "",
        principalId: "usr_admin",
        connectedAccount: { id: "acct_slack", status: "active", principalId: "usr_admin" },
        provenanceUrl: "https://slack.com/archives/C123/p1719600100000000",
        title: "Broken sync",
        normalizedText: "Broken",
        raw: { secret: "should-not-surface" },
        acl: { teams: ["platform"], roles: ["admin"], sensitivity: "internal" }
      })
    ).rejects.toThrow();
    const ops = createConnectorOps({
      controlPlane: { getState: async () => controlState() },
      ingestionPipeline: pipeline
    });

    const health = await ops.health();

    expect(health.connectors[0].recentErrors[0]).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/source object id/i),
      guidance: "Check connector permissions, source scope, checkpoint cursor, and connected-account status before retrying."
    });
    expect(JSON.stringify(health.connectors[0].recentErrors[0])).not.toContain("should-not-surface");
  });
});
