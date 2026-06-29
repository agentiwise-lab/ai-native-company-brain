import { describe, expect, it } from "vitest";
import {
  createComposioIngestionPipeline,
  type ComposioIngestionInput,
  type ComposioIngestionState,
  type ComposioIngestionStore
} from "../lib/composio-ingestion";

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

const baseInput: ComposioIngestionInput = {
  connector: "slack",
  sourceType: "slack" as const,
  sourceObjectId: "msg_123",
  sourceUpdatedAt: "2026-06-29T10:00:00.000Z",
  principalId: "usr_admin",
  connectedAccount: {
    id: "acct_slack",
    status: "active" as const,
    principalId: "usr_admin"
  },
  provenanceUrl: "https://slack.com/archives/C123/p123",
  title: "Slack customer handoff",
  normalizedText: "Customer handoff details from Slack.",
  raw: {
    id: "msg_123",
    text: "Customer handoff details from Slack."
  },
  acl: {
    teams: ["platform"],
    roles: ["admin", "reviewer", "operator", "agent"],
    sensitivity: "internal" as const
  },
  checkpoint: {
    cursor: "cursor_123"
  }
};

describe("Composio ingestion pipeline", () => {
  it("creates a normalized source artifact with metadata, checkpoint, and audit event", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store, now: () => "2026-06-29T12:00:00.000Z" });

    const result = await pipeline.ingestComposioResult(baseInput);

    expect(result.status).toBe("created");
    expect(result.artifact).toMatchObject({
      connector: "slack",
      sourceObjectId: "msg_123",
      connectedAccountId: "acct_slack",
      principalId: "usr_admin",
      provenanceUrl: "https://slack.com/archives/C123/p123",
      normalizedText: "Customer handoff details from Slack.",
      source: {
        sourceType: "slack",
        sensitivity: "internal"
      }
    });
    expect(store.snapshot()?.artifacts).toHaveLength(1);
    expect(store.snapshot()?.checkpoints[0]).toMatchObject({
      connector: "slack",
      connectedAccountId: "acct_slack",
      cursor: "cursor_123",
      lastSourceObjectId: "msg_123"
    });
    expect(store.snapshot()?.auditEvents[0]).toMatchObject({
      action: "ingest",
      policyDecision: "allow"
    });
  });

  it("updates an existing artifact when the source checksum changes", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store, now: () => "2026-06-29T12:00:00.000Z" });

    await pipeline.ingestComposioResult(baseInput);
    const updated = await pipeline.ingestComposioResult({
      ...baseInput,
      normalizedText: "Updated Slack handoff details.",
      raw: { id: "msg_123", text: "Updated Slack handoff details." },
      checkpoint: { cursor: "cursor_124" }
    });

    expect(updated.status).toBe("updated");
    expect(store.snapshot()?.artifacts).toHaveLength(1);
    expect(store.snapshot()?.artifacts[0].normalizedText).toBe("Updated Slack handoff details.");
    expect(store.snapshot()?.checkpoints[0].cursor).toBe("cursor_124");
  });

  it("skips duplicate artifacts when source object and checksum match", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });

    await pipeline.ingestComposioResult(baseInput);
    const duplicate = await pipeline.ingestComposioResult(baseInput);

    expect(duplicate.status).toBe("duplicate");
    expect(store.snapshot()?.artifacts).toHaveLength(1);
  });

  it("records a failed run for malformed action results", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });

    await expect(
      pipeline.ingestComposioResult({
        ...baseInput,
        sourceObjectId: "",
        normalizedText: ""
      })
    ).rejects.toThrow(/source object/i);

    expect(store.snapshot()?.runs[0]).toMatchObject({
      status: "failed",
      connector: "slack"
    });
  });

  it("blocks ingestion for revoked connected accounts", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });

    await expect(
      pipeline.ingestComposioResult({
        ...baseInput,
        connectedAccount: {
          id: "acct_slack",
          status: "revoked",
          principalId: "usr_admin"
        }
      })
    ).rejects.toThrow(/revoked/i);

    expect(store.snapshot()?.artifacts).toHaveLength(0);
  });
});
