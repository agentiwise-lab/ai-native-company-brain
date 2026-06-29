import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST as commitBrain } from "../app/api/v1/brain/commit/route";
import { POST as queryBrain } from "../app/api/v1/brain/query/route";
import { POST as mergeChangeset } from "../app/api/v1/changesets/[id]/merge/route";
import { PATCH as reviewChangeset } from "../app/api/v1/changesets/[id]/review/route";
import { createComposioIngestionPipeline, type ComposioIngestionState, type ComposioIngestionStore } from "../lib/composio-ingestion";
import {
  createFlexibleComposioIngestion,
  type FlexibleIngestionStore,
  type NotionComposioClient,
  type NotionSyncInput,
  type WebhookIngestionInput
} from "../lib/flexible-composio-ingestion";

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

function createFlexibleStore() {
  let state = { disabledSources: [] as string[], replays: [] as Array<{ sourceId: string; replayedAt: string }> };
  const store: FlexibleIngestionStore & { snapshot: () => typeof state } = {
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

function jsonRequest(path: string, body: unknown, method = "POST") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-principal-id": "usr_reviewer",
      "x-tenant-id": "tenant_demo"
    },
    body: JSON.stringify(body)
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function sign(secret: string, body: unknown) {
  return `sha256=${createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex")}`;
}

function baseNotionInput(overrides: Partial<NotionSyncInput> = {}): NotionSyncInput {
  return {
    principalId: "usr_admin",
    mode: "backfill",
    connectedAccount: {
      id: "acct_notion",
      status: "active",
      principalId: "usr_admin"
    },
    selectedSources: [
      {
        id: "page_123",
        kind: "page",
        name: "Operating handbook",
        teams: ["platform"],
        roles: ["admin", "reviewer", "operator", "agent"],
        sensitivity: "internal"
      }
    ],
    allowedSourceIds: ["page_123"],
    ...overrides
  };
}

function notionPage() {
  return {
    pages: [
      {
        id: "page_123",
        title: "Operating handbook",
        url: "https://notion.so/page_123",
        workspace: "Acme Notion",
        database: "Knowledge",
        author: "Anika",
        updatedAt: "2026-06-29T12:00:00.000Z",
        blocks: [
          { id: "b1", type: "paragraph", text: "The agent-native rollout starts with source-backed memory." },
          { id: "b2", type: "unsupported", text: "", unsupported: true }
        ],
        comments: [{ id: "n1", author: "Reviewer", text: "Approved.", createdAt: "2026-06-29T12:10:00.000Z" }]
      }
    ],
    nextCursor: "notion_cursor_1"
  };
}

function createFakeNotionClient(payload = notionPage()): NotionComposioClient & { calls: NotionSyncInput[] } {
  return {
    calls: [],
    async fetchNotion(input) {
      this.calls.push(input);
      return payload;
    }
  };
}

function webhookInput(body: Partial<WebhookIngestionInput["payload"]> = {}, secret = "webhook-secret"): WebhookIngestionInput {
  const payload = {
    sourceId: "external_tool:item_123",
    sourceType: "docs" as const,
    title: "External research note",
    provenanceUrl: "https://external.example.com/item_123",
    principalId: "usr_admin",
    content: "External source says the flexible ingestion path is approved.",
    raw: { id: "item_123", nested: true },
    acl: {
      teams: ["platform"],
      roles: ["admin", "reviewer", "operator", "agent"] as Array<"admin" | "reviewer" | "operator" | "agent">,
      sensitivity: "internal" as const
    },
    ...body
  };
  return {
    secret,
    signature: sign(secret, payload),
    payload
  };
}

describe("Flexible Composio ingestion", () => {
  it("syncs Notion pages, comments, and unsupported blocks into source artifacts", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const notionClient = createFakeNotionClient();
    const worker = createFlexibleComposioIngestion({ ingestionPipeline: pipeline, notionClient });

    const result = await worker.syncNotion(baseNotionInput());

    expect(result.statuses).toEqual(["created"]);
    expect(result.artifacts[0]).toMatchObject({
      connector: "notion",
      sourceObjectId: "notion:acct_notion:page_123",
      provenanceUrl: "https://notion.so/page_123",
      source: {
        sourceType: "docs",
        title: "Operating handbook"
      }
    });
    expect(result.artifacts[0].normalizedText).toContain("Workspace: Acme Notion");
    expect(result.artifacts[0].normalizedText).toContain("Unsupported block: b2 unsupported");
    expect(result.artifacts[0].normalizedText).toContain("Comment n1 by Reviewer");
  });

  it("accepts signed generic webhooks as governed source artifacts", async () => {
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const worker = createFlexibleComposioIngestion({ ingestionPipeline: pipeline });

    const result = await worker.ingestWebhook(webhookInput());

    expect(result.status).toBe("created");
    expect(result.artifact).toMatchObject({
      connector: "webhook",
      sourceObjectId: "webhook:external_tool:item_123",
      provenanceUrl: "https://external.example.com/item_123",
      acl: {
        sensitivity: "internal"
      }
    });
  });

  it("rejects invalid webhook signatures before artifact writes", async () => {
    const store = createMemoryStore();
    const worker = createFlexibleComposioIngestion({ ingestionPipeline: createComposioIngestionPipeline({ store }) });

    await expect(worker.ingestWebhook({ ...webhookInput(), signature: "sha256=bad" })).rejects.toThrow(/signature/i);

    expect(store.snapshot()?.artifacts ?? []).toHaveLength(0);
  });

  it("rejects malformed webhook payloads", async () => {
    const worker = createFlexibleComposioIngestion({ ingestionPipeline: createComposioIngestionPipeline({ store: createMemoryStore() }) });
    const malformed = webhookInput({ sourceId: "", content: "" });
    malformed.signature = sign(malformed.secret, malformed.payload);

    await expect(worker.ingestWebhook(malformed)).rejects.toThrow(/payload/i);
  });

  it("deduplicates repeated webhook payloads", async () => {
    const store = createMemoryStore();
    const worker = createFlexibleComposioIngestion({ ingestionPipeline: createComposioIngestionPipeline({ store }) });

    await worker.ingestWebhook(webhookInput());
    const duplicate = await worker.ingestWebhook(webhookInput());

    expect(duplicate.status).toBe("duplicate");
    expect(store.snapshot()?.artifacts).toHaveLength(1);
  });

  it("blocks revoked Notion accounts before client calls", async () => {
    const notionClient = createFakeNotionClient();
    const worker = createFlexibleComposioIngestion({
      ingestionPipeline: createComposioIngestionPipeline({ store: createMemoryStore() }),
      notionClient
    });

    await expect(
      worker.syncNotion(
        baseNotionInput({
          connectedAccount: {
            id: "acct_notion",
            status: "revoked",
            principalId: "usr_admin"
          }
        })
      )
    ).rejects.toThrow(/revoked/i);

    expect(notionClient.calls).toHaveLength(0);
  });

  it("disables and replays source state for operators", async () => {
    const flexibleStore = createFlexibleStore();
    const worker = createFlexibleComposioIngestion({
      ingestionPipeline: createComposioIngestionPipeline({ store: createMemoryStore() }),
      store: flexibleStore,
      now: () => "2026-06-29T14:00:00.000Z"
    });

    await worker.disableSource("webhook:external_tool");
    await worker.replaySource("webhook:external_tool");

    expect(flexibleStore.snapshot()).toEqual({
      disabledSources: ["webhook:external_tool"],
      replays: [{ sourceId: "webhook:external_tool", replayedAt: "2026-06-29T14:00:00.000Z" }]
    });
  });

  it("commits, reviews, merges, and queries flexible artifacts with citations", async () => {
    const token = `flexible-derived-${Date.now()}`;
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const worker = createFlexibleComposioIngestion({ ingestionPipeline: pipeline });
    const result = await worker.ingestWebhook(webhookInput({ content: `The ${token} source is approved.` }));
    const artifact = result.artifact;

    const commitResponse = await commitBrain(
      jsonRequest("/api/v1/brain/commit", {
        title: `Flexible source ${token}`,
        body: artifact.normalizedText,
        tier: "team",
        sourceIds: [artifact.id],
        sourceUri: artifact.provenanceUrl,
        sourceTitle: artifact.source.title
      })
    );
    const committed = await commitResponse.json();
    expect(commitResponse.status).toBe(201);

    await reviewChangeset(
      jsonRequest(`/api/v1/changesets/${committed.changeset.id}/review`, {
        action: "approve",
        note: "Flexible source evidence is sufficient."
      }, "PATCH"),
      params(committed.changeset.id)
    );
    const mergeResponse = await mergeChangeset(
      jsonRequest(`/api/v1/changesets/${committed.changeset.id}/merge`, {}),
      params(committed.changeset.id)
    );
    expect(mergeResponse.status).toBe(200);

    const queryResponse = await queryBrain(jsonRequest("/api/v1/brain/query", { query: token, principalId: "usr_reviewer" }));
    const query = await queryResponse.json();

    expect(query.citations.map((atom: { id: string }) => atom.id)).toContain(committed.atom.id);
  });
});
