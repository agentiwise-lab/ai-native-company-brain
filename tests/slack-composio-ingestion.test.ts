import { describe, expect, it } from "vitest";
import { POST as commitBrain } from "../app/api/v1/brain/commit/route";
import { POST as queryBrain } from "../app/api/v1/brain/query/route";
import { POST as mergeChangeset } from "../app/api/v1/changesets/[id]/merge/route";
import { PATCH as reviewChangeset } from "../app/api/v1/changesets/[id]/review/route";
import { createComposioIngestionPipeline, type ComposioIngestionState, type ComposioIngestionStore } from "../lib/composio-ingestion";
import {
  createSlackComposioIngestion,
  type SlackComposioClient,
  type SlackSyncInput
} from "../lib/slack-composio-ingestion";

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

function baseSyncInput(overrides: Partial<SlackSyncInput> = {}): SlackSyncInput {
  return {
    principalId: "usr_admin",
    workspaceId: "T123",
    workspaceName: "Acme Slack",
    mode: "backfill",
    connectedAccount: {
      id: "acct_slack",
      status: "active",
      principalId: "usr_admin"
    },
    selectedChannels: [
      {
        id: "C123",
        name: "customer-handoffs",
        teams: ["platform"],
        roles: ["admin", "reviewer", "operator", "agent"],
        sensitivity: "internal"
      }
    ],
    allowedChannelIds: ["C123"],
    sinceTs: "1719600000.000000",
    ...overrides
  };
}

function threadPayload(text = "Customer ACME needs the rollout decision by Friday.") {
  return {
    workspaceId: "T123",
    workspaceName: "Acme Slack",
    messages: [
      {
        channelId: "C123",
        channelName: "customer-handoffs",
        ts: "1719600100.000000",
        threadTs: "1719600100.000000",
        userId: "U1",
        userName: "Anika",
        text,
        permalink: "https://slack.com/archives/C123/p1719600100000000",
        replies: [
          {
            channelId: "C123",
            ts: "1719600110.000000",
            threadTs: "1719600100.000000",
            userId: "U2",
            userName: "Dev",
            text: "Assign implementation owner before the weekly review."
          }
        ],
        files: [
          {
            id: "F1",
            name: "handoff.pdf",
            url: "https://files.slack.com/files-pri/T123-F1/handoff.pdf"
          }
        ]
      }
    ],
    nextCursor: "cursor_after_1719600100"
  };
}

function createFakeSlackClient(payloads: Array<ReturnType<typeof threadPayload>>): SlackComposioClient & { calls: SlackSyncInput[] } {
  return {
    calls: [],
    async fetchChannelHistory(input) {
      this.calls.push(input);
      return payloads[Math.min(this.calls.length - 1, payloads.length - 1)];
    }
  };
}

describe("Slack Composio ingestion", () => {
  it("backfills selected Slack channels into normalized source artifacts", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store, now: () => "2026-06-29T13:00:00.000Z" });
    const slackClient = createFakeSlackClient([threadPayload()]);
    const worker = createSlackComposioIngestion({ ingestionPipeline: pipeline, slackClient });

    const result = await worker.syncSlack(baseSyncInput());

    expect(result.statuses).toEqual(["created"]);
    expect(result.artifacts[0]).toMatchObject({
      connector: "slack",
      sourceObjectId: "slack:T123:C123:1719600100.000000",
      principalId: "usr_admin",
      provenanceUrl: "https://slack.com/archives/C123/p1719600100000000",
      acl: {
        sensitivity: "internal",
        teams: ["platform"]
      },
      source: {
        sourceType: "slack",
        title: "Slack #customer-handoffs thread 1719600100.000000"
      }
    });
    expect(result.artifacts[0].normalizedText).toContain("Anika: Customer ACME");
    expect(result.artifacts[0].normalizedText).toContain("File: handoff.pdf");
    expect(store.snapshot()?.checkpoints[0]).toMatchObject({
      connector: "slack",
      connectedAccountId: "acct_slack",
      cursor: "cursor_after_1719600100",
      lastSourceObjectId: "slack:T123:C123:1719600100.000000"
    });
  });

  it("uses the prior checkpoint for incremental sync and updates changed threads", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const slackClient = createFakeSlackClient([
      threadPayload(),
      threadPayload("Customer ACME moved the rollout decision to Monday.")
    ]);
    const worker = createSlackComposioIngestion({ ingestionPipeline: pipeline, slackClient });

    await worker.syncSlack(baseSyncInput({ mode: "backfill" }));
    const result = await worker.syncSlack(baseSyncInput({ mode: "incremental", sinceTs: undefined }));

    expect(slackClient.calls[1]).toMatchObject({
      cursor: "cursor_after_1719600100",
      mode: "incremental"
    });
    expect(result.statuses).toEqual(["updated"]);
    expect(store.snapshot()?.artifacts).toHaveLength(1);
    expect(store.snapshot()?.artifacts[0].normalizedText).toContain("Monday");
  });

  it("blocks sync for revoked Slack connected accounts", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const slackClient = createFakeSlackClient([threadPayload()]);
    const worker = createSlackComposioIngestion({ ingestionPipeline: pipeline, slackClient });

    await expect(
      worker.syncSlack(
        baseSyncInput({
          connectedAccount: {
            id: "acct_slack",
            status: "revoked",
            principalId: "usr_admin"
          }
        })
      )
    ).rejects.toThrow(/revoked/i);

    expect(slackClient.calls).toHaveLength(0);
    expect(store.snapshot()?.artifacts ?? []).toHaveLength(0);
  });

  it("rejects channels outside the selected account permission scope", async () => {
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const slackClient = createFakeSlackClient([threadPayload()]);
    const worker = createSlackComposioIngestion({ ingestionPipeline: pipeline, slackClient });

    await expect(worker.syncSlack(baseSyncInput({ allowedChannelIds: ["C999"] }))).rejects.toThrow(/not allowed/i);

    expect(slackClient.calls).toHaveLength(0);
  });

  it("deduplicates repeated Slack thread payloads through the shared ingestion path", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const slackClient = createFakeSlackClient([threadPayload(), threadPayload()]);
    const worker = createSlackComposioIngestion({ ingestionPipeline: pipeline, slackClient });

    await worker.syncSlack(baseSyncInput());
    const duplicate = await worker.syncSlack(baseSyncInput());

    expect(duplicate.statuses).toEqual(["duplicate"]);
    expect(store.snapshot()?.artifacts).toHaveLength(1);
  });

  it("commits, reviews, merges, and queries Slack-derived artifacts with citations", async () => {
    const token = `slack-derived-${Date.now()}`;
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const slackClient = createFakeSlackClient([threadPayload(`The ${token} operating decision is approved.`)]);
    const worker = createSlackComposioIngestion({ ingestionPipeline: pipeline, slackClient });
    const sync = await worker.syncSlack(baseSyncInput());
    const artifact = sync.artifacts[0];

    const commitResponse = await commitBrain(
      jsonRequest("/api/v1/brain/commit", {
        title: `Slack decision ${token}`,
        body: artifact.normalizedText,
        tier: "team",
        sourceIds: [artifact.id],
        sourceUri: artifact.provenanceUrl,
        sourceTitle: artifact.source.title
      })
    );
    const committed = await commitResponse.json();
    expect(commitResponse.status).toBe(201);

    const reviewResponse = await reviewChangeset(
      jsonRequest(`/api/v1/changesets/${committed.changeset.id}/review`, {
        action: "approve",
        note: "Slack source evidence is sufficient."
      }, "PATCH"),
      params(committed.changeset.id)
    );
    expect(reviewResponse.status).toBe(200);

    const mergeResponse = await mergeChangeset(
      jsonRequest(`/api/v1/changesets/${committed.changeset.id}/merge`, {}),
      params(committed.changeset.id)
    );
    expect(mergeResponse.status).toBe(200);

    const queryResponse = await queryBrain(
      jsonRequest("/api/v1/brain/query", {
        query: token,
        principalId: "usr_reviewer"
      })
    );
    const query = await queryResponse.json();

    expect(queryResponse.status).toBe(200);
    expect(query.citations.map((atom: { id: string }) => atom.id)).toContain(committed.atom.id);
  });
});
