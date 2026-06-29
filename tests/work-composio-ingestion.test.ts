import { describe, expect, it } from "vitest";
import { POST as commitBrain } from "../app/api/v1/brain/commit/route";
import { POST as queryBrain } from "../app/api/v1/brain/query/route";
import { POST as mergeChangeset } from "../app/api/v1/changesets/[id]/merge/route";
import { PATCH as reviewChangeset } from "../app/api/v1/changesets/[id]/review/route";
import { createComposioIngestionPipeline, type ComposioIngestionState, type ComposioIngestionStore } from "../lib/composio-ingestion";
import {
  createWorkComposioIngestion,
  type WorkComposioClient,
  type WorkSyncInput
} from "../lib/work-composio-ingestion";

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

function baseInput(overrides: Partial<WorkSyncInput> = {}): WorkSyncInput {
  return {
    principalId: "usr_admin",
    mode: "backfill",
    connectedAccount: {
      id: "acct_work",
      status: "active",
      principalId: "usr_admin"
    },
    selectedSources: [
      {
        kind: "github",
        scope: "github:repo:agentiwise-lab/ai-native-company-brain",
        name: "ai-native-company-brain",
        teams: ["platform"],
        roles: ["admin", "reviewer", "operator", "agent"],
        sensitivity: "internal"
      }
    ],
    allowedScopes: ["github:repo:agentiwise-lab/ai-native-company-brain", "linear:project:AI-Native Company Brain"],
    ...overrides
  };
}

function githubPage(title = "Add governed ingestion", nextCursor?: string) {
  return {
    items: [
      {
        kind: "pull-request" as const,
        id: "pr_123",
        number: 123,
        title,
        url: "https://github.com/agentiwise-lab/ai-native-company-brain/pull/123",
        repo: "agentiwise-lab/ai-native-company-brain",
        author: "harshit",
        status: "merged",
        labels: ["ingestion", "backend"],
        updatedAt: "2026-06-29T10:00:00.000Z",
        body: "Adds governed ingestion for product work.",
        comments: [
          { id: "c1", author: "reviewer", body: "Looks good.", createdAt: "2026-06-29T10:10:00.000Z" },
          { id: "c1", author: "reviewer", body: "Looks good.", createdAt: "2026-06-29T10:10:00.000Z" }
        ],
        deleted: undefined as boolean | undefined,
        renamedFrom: undefined as string | undefined
      }
    ],
    nextCursor
  };
}

function linearPage(title = "Ship Composio ingestion") {
  return {
    items: [
      {
        id: "lin_123",
        identifier: "AGE-123",
        title,
        url: "https://linear.app/agentiwise/issue/AGE-123/ship-composio-ingestion",
        project: "AI-Native Company Brain",
        team: "Agentiwise",
        author: "Harshit",
        status: "Done",
        labels: ["Feature"],
        updatedAt: "2026-06-29T11:00:00.000Z",
        body: "Ship product work ingestion into governed artifacts.",
        comments: [
          { id: "lc1", author: "Reviewer", body: "Approved.", createdAt: "2026-06-29T11:10:00.000Z" }
        ]
      }
    ],
    nextCursor: undefined
  };
}

function createFakeWorkClient(input: {
  github?: ReturnType<typeof githubPage>[];
  linear?: ReturnType<typeof linearPage>[];
}): WorkComposioClient & { githubCalls: WorkSyncInput[]; linearCalls: WorkSyncInput[] } {
  return {
    githubCalls: [],
    linearCalls: [],
    async fetchGitHub(inputPayload) {
      this.githubCalls.push(inputPayload);
      const index = Math.min(this.githubCalls.length - 1, (input.github?.length ?? 1) - 1);
      return input.github?.[index] ?? { items: [], nextCursor: undefined };
    },
    async fetchLinear(inputPayload) {
      this.linearCalls.push(inputPayload);
      const index = Math.min(this.linearCalls.length - 1, (input.linear?.length ?? 1) - 1);
      return input.linear?.[index] ?? { items: [], nextCursor: undefined };
    }
  };
}

describe("Work Composio ingestion", () => {
  it("syncs paginated GitHub work items with metadata and deduplicated comments", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const client = createFakeWorkClient({
      github: [
        githubPage("Add governed ingestion", "gh_cursor_1"),
        {
          items: [
            {
              ...githubPage("Follow-up ingestion hardening").items[0],
              id: "pr_124",
              number: 124,
              url: "https://github.com/agentiwise-lab/ai-native-company-brain/pull/124"
            }
          ],
          nextCursor: undefined
        }
      ]
    });
    const worker = createWorkComposioIngestion({ ingestionPipeline: pipeline, workClient: client });

    const result = await worker.syncWork(baseInput());

    expect(client.githubCalls).toHaveLength(2);
    expect(client.githubCalls[1]).toMatchObject({ cursor: "gh_cursor_1" });
    expect(result.statuses).toEqual(["created", "created"]);
    expect(result.artifacts[0]).toMatchObject({
      connector: "github",
      sourceObjectId: "github:acct_work:agentiwise-lab/ai-native-company-brain:pull-request:123",
      source: {
        sourceType: "code",
        title: "Add governed ingestion"
      }
    });
    expect(result.artifacts[0].normalizedText).toContain("Repo: agentiwise-lab/ai-native-company-brain");
    expect(result.artifacts[0].normalizedText.match(/Looks good/g)).toHaveLength(1);
  });

  it("syncs Linear project work into ticket artifacts with project context", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const client = createFakeWorkClient({ linear: [linearPage()] });
    const worker = createWorkComposioIngestion({ ingestionPipeline: pipeline, workClient: client });

    const result = await worker.syncWork(
      baseInput({
        selectedSources: [
          {
            kind: "linear",
            scope: "linear:project:AI-Native Company Brain",
            name: "AI-Native Company Brain",
            teams: ["product"],
            roles: ["admin", "reviewer", "operator", "agent"],
            sensitivity: "internal"
          }
        ]
      })
    );

    expect(result.artifacts[0]).toMatchObject({
      connector: "linear",
      sourceObjectId: "linear:acct_work:AGE-123",
      source: {
        sourceType: "ticket",
        title: "Ship Composio ingestion"
      },
      acl: {
        teams: ["product"]
      }
    });
    expect(result.artifacts[0].normalizedText).toContain("Project: AI-Native Company Brain");
    expect(result.artifacts[0].normalizedText).toContain("Status: Done");
  });

  it("preserves deleted and renamed source state", async () => {
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const client = createFakeWorkClient({
      github: [
        {
          items: [
            {
              ...githubPage("Renamed ingestion issue").items[0],
              deleted: true,
              renamedFrom: "Old ingestion issue"
            }
          ],
          nextCursor: undefined
        }
      ]
    });
    const worker = createWorkComposioIngestion({ ingestionPipeline: pipeline, workClient: client });

    const result = await worker.syncWork(baseInput());

    expect(result.artifacts[0].normalizedText).toContain("Deleted: true");
    expect(result.artifacts[0].normalizedText).toContain("Renamed from: Old ingestion issue");
    expect(result.artifacts[0].raw).toMatchObject({
      item: {
        deleted: true,
        renamedFrom: "Old ingestion issue"
      }
    });
  });

  it("rejects missing repo or project permissions before client calls", async () => {
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const client = createFakeWorkClient({ github: [githubPage()] });
    const worker = createWorkComposioIngestion({ ingestionPipeline: pipeline, workClient: client });

    await expect(worker.syncWork(baseInput({ allowedScopes: ["linear:project:Other"] }))).rejects.toThrow(/permission/i);

    expect(client.githubCalls).toHaveLength(0);
  });

  it("blocks sync for revoked work connected accounts", async () => {
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const client = createFakeWorkClient({ github: [githubPage()] });
    const worker = createWorkComposioIngestion({ ingestionPipeline: pipeline, workClient: client });

    await expect(
      worker.syncWork(
        baseInput({
          connectedAccount: {
            id: "acct_work",
            status: "revoked",
            principalId: "usr_admin"
          }
        })
      )
    ).rejects.toThrow(/revoked/i);

    expect(client.githubCalls).toHaveLength(0);
  });

  it("deduplicates repeated GitHub and Linear payloads through the shared ingestion path", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const client = createFakeWorkClient({
      github: [githubPage(), githubPage()],
      linear: [linearPage(), linearPage()]
    });
    const worker = createWorkComposioIngestion({ ingestionPipeline: pipeline, workClient: client });
    const input = baseInput({
      selectedSources: [
        baseInput().selectedSources[0],
        {
          kind: "linear",
          scope: "linear:project:AI-Native Company Brain",
          name: "AI-Native Company Brain",
          teams: ["platform"],
          roles: ["admin", "reviewer", "operator", "agent"],
          sensitivity: "internal"
        }
      ]
    });

    await worker.syncWork(input);
    const duplicate = await worker.syncWork(input);

    expect(duplicate.statuses).toEqual(["duplicate", "duplicate"]);
    expect(store.snapshot()?.artifacts).toHaveLength(2);
  });

  it("commits, reviews, merges, and queries work-derived artifacts with citations", async () => {
    const token = `work-derived-${Date.now()}`;
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const client = createFakeWorkClient({ github: [githubPage(`The ${token} decision shipped`)] });
    const worker = createWorkComposioIngestion({ ingestionPipeline: pipeline, workClient: client });
    const sync = await worker.syncWork(baseInput());
    const artifact = sync.artifacts[0];

    const commitResponse = await commitBrain(
      jsonRequest("/api/v1/brain/commit", {
        title: `Work decision ${token}`,
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
        note: "Work source evidence is sufficient."
      }, "PATCH"),
      params(committed.changeset.id)
    );
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

    expect(query.citations.map((atom: { id: string }) => atom.id)).toContain(committed.atom.id);
  });
});
