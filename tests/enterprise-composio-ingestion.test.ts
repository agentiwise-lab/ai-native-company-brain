import { describe, expect, it } from "vitest";
import { POST as commitBrain } from "../app/api/v1/brain/commit/route";
import { POST as queryBrain } from "../app/api/v1/brain/query/route";
import { POST as mergeChangeset } from "../app/api/v1/changesets/[id]/merge/route";
import { PATCH as reviewChangeset } from "../app/api/v1/changesets/[id]/review/route";
import { createComposioIngestionPipeline, type ComposioIngestionState, type ComposioIngestionStore } from "../lib/composio-ingestion";
import {
  createEnterpriseComposioIngestion,
  type EnterpriseComposioClient,
  type EnterpriseSyncInput
} from "../lib/enterprise-composio-ingestion";

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

function baseInput(overrides: Partial<EnterpriseSyncInput> = {}): EnterpriseSyncInput {
  return {
    principalId: "usr_admin",
    mode: "backfill",
    connectedAccount: {
      id: "acct_enterprise",
      status: "active",
      principalId: "usr_admin"
    },
    selectedSources: [
      {
        kind: "microsoft-outlook",
        scope: "microsoft:outlook:mail.read",
        name: "Executive inbox",
        teams: ["platform"],
        roles: ["admin", "reviewer", "operator", "agent"],
        sensitivity: "confidential",
        coverage: { acl: true, delta: true, webhook: true }
      }
    ],
    allowedScopes: [
      "microsoft:outlook:mail.read",
      "jira:project:AI",
      "confluence:space:ENG",
      "gitlab:project:agent-platform"
    ],
    ...overrides
  };
}

type MicrosoftFixturePage = {
  items: Array<{
    id: string;
    kind: "outlook-email";
    title: string;
    url: string;
    author: string;
    createdAt: string;
    updatedAt: string;
    body: string;
    structure: Record<string, unknown>;
    aclMetadata: Record<string, unknown>;
  }>;
  nextCursor?: string;
};

function microsoftPage(nextCursor = "ms_cursor_1"): MicrosoftFixturePage {
  return {
    items: [
      {
        id: "msg_123",
        kind: "outlook-email" as const,
        title: "Enterprise rollout approval",
        url: "https://outlook.office.com/mail/msg_123",
        author: "cto@example.com",
        createdAt: "2026-06-30T06:30:00.000Z",
        updatedAt: "2026-06-30T06:45:00.000Z",
        body: "Approved enterprise connector rollout after security review.",
        structure: { folder: "Inbox", recipients: ["platform@example.com"] },
        aclMetadata: { groups: ["Platform"], users: ["cto@example.com"] }
      }
    ],
    nextCursor
  };
}

function jiraPage(key = "AI-123", nextCursor?: string) {
  return {
    items: [
      {
        id: key.toLowerCase(),
        key,
        title: `Jira rollout task ${key}`,
        url: `https://jira.example.com/browse/${key}`,
        project: "AI",
        author: "pm@example.com",
        status: "Done",
        updatedAt: "2026-06-30T06:50:00.000Z",
        body: "Track connector rollout.",
        comments: [{ id: `${key}-c1`, author: "eng@example.com", body: "Ready for review.", createdAt: "2026-06-30T06:51:00.000Z" }]
      }
    ],
    nextCursor
  };
}

function confluencePage(id = "conf_1", nextCursor?: string) {
  return {
    items: [
      {
        id,
        title: `Confluence connector page ${id}`,
        url: `https://confluence.example.com/pages/${id}`,
        space: "ENG",
        author: "writer@example.com",
        updatedAt: "2026-06-30T06:52:00.000Z",
        body: "Connector rollout notes.",
        comments: [{ id: `${id}-c1`, author: "reviewer@example.com", body: "Documented.", createdAt: "2026-06-30T06:53:00.000Z" }]
      }
    ],
    nextCursor
  };
}

function gitLabPage(title = "Enterprise connector merge request") {
  return {
    items: [
      {
        kind: "merge-request" as const,
        id: "mr_77",
        iid: 77,
        title,
        url: "https://gitlab.example.com/agent-platform/-/merge_requests/77",
        project: "agent-platform",
        author: "dev@example.com",
        status: "merged",
        updatedAt: "2026-06-30T07:00:00.000Z",
        body: "Implements enterprise connector sync.",
        comments: [
          { id: "gl-c1", author: "reviewer@example.com", body: "Security checks passed.", createdAt: "2026-06-30T07:01:00.000Z" }
        ]
      }
    ],
    nextCursor: undefined
  };
}

function createFakeClient(input: {
  microsoft?: MicrosoftFixturePage[];
  jira?: ReturnType<typeof jiraPage>[];
  confluence?: ReturnType<typeof confluencePage>[];
  gitlab?: ReturnType<typeof gitLabPage>[];
}): EnterpriseComposioClient & {
  microsoftCalls: EnterpriseSyncInput[];
  jiraCalls: EnterpriseSyncInput[];
  confluenceCalls: EnterpriseSyncInput[];
  gitlabCalls: EnterpriseSyncInput[];
} {
  return {
    microsoftCalls: [],
    jiraCalls: [],
    confluenceCalls: [],
    gitlabCalls: [],
    async fetchMicrosoft(inputPayload) {
      this.microsoftCalls.push(inputPayload);
      const index = Math.min(this.microsoftCalls.length - 1, (input.microsoft?.length ?? 1) - 1);
      return input.microsoft?.[index] ?? { items: [], nextCursor: undefined };
    },
    async fetchJira(inputPayload) {
      this.jiraCalls.push(inputPayload);
      const index = Math.min(this.jiraCalls.length - 1, (input.jira?.length ?? 1) - 1);
      return input.jira?.[index] ?? { items: [], nextCursor: undefined };
    },
    async fetchConfluence(inputPayload) {
      this.confluenceCalls.push(inputPayload);
      const index = Math.min(this.confluenceCalls.length - 1, (input.confluence?.length ?? 1) - 1);
      return input.confluence?.[index] ?? { items: [], nextCursor: undefined };
    },
    async fetchGitLab(inputPayload) {
      this.gitlabCalls.push(inputPayload);
      const index = Math.min(this.gitlabCalls.length - 1, (input.gitlab?.length ?? 1) - 1);
      return input.gitlab?.[index] ?? { items: [], nextCursor: undefined };
    }
  };
}

describe("Enterprise Composio ingestion", () => {
  it("syncs a Microsoft source with provenance, authorship, timestamps, structure, and ACL metadata", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const client = createFakeClient({ microsoft: [microsoftPage(), { items: [], nextCursor: undefined }] });
    const worker = createEnterpriseComposioIngestion({ ingestionPipeline: pipeline, enterpriseClient: client });

    const result = await worker.syncEnterprise(baseInput());

    expect(result.statuses).toEqual(["created"]);
    expect(result.artifacts[0]).toMatchObject({
      connector: "microsoft-outlook",
      provenanceUrl: "https://outlook.office.com/mail/msg_123",
      source: {
        sourceType: "email",
        title: "Enterprise rollout approval",
        capturedAt: "2026-06-30T06:45:00.000Z"
      },
      acl: {
        sensitivity: "confidential",
        teams: ["platform"]
      }
    });
    expect(result.artifacts[0].normalizedText).toContain("Author: cto@example.com");
    expect(result.artifacts[0].normalizedText).toContain("Structure folder: Inbox");
    expect(result.artifacts[0].normalizedText).toContain("ACL groups: Platform");
    expect(store.snapshot()?.checkpoints[0]).toMatchObject({ connector: "microsoft-outlook", cursor: "ms_cursor_1" });
  });

  it("paginates Jira and Confluence sources with checkpoint updates", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const client = createFakeClient({
      jira: [jiraPage("AI-123", "jira_cursor_1"), jiraPage("AI-124")],
      confluence: [confluencePage("conf_1", "conf_cursor_1"), confluencePage("conf_2")]
    });
    const worker = createEnterpriseComposioIngestion({ ingestionPipeline: pipeline, enterpriseClient: client });

    const result = await worker.syncEnterprise(
      baseInput({
        selectedSources: [
          {
            kind: "jira",
            scope: "jira:project:AI",
            name: "AI project",
            teams: ["platform"],
            roles: ["admin", "reviewer", "operator", "agent"],
            sensitivity: "internal",
            coverage: { acl: true, delta: true, webhook: true }
          },
          {
            kind: "confluence",
            scope: "confluence:space:ENG",
            name: "Engineering space",
            teams: ["platform"],
            roles: ["admin", "reviewer", "operator", "agent"],
            sensitivity: "internal",
            coverage: { acl: true, delta: true, webhook: true }
          }
        ]
      })
    );

    expect(client.jiraCalls).toHaveLength(2);
    expect(client.jiraCalls[1]).toMatchObject({ cursor: "jira_cursor_1" });
    expect(client.confluenceCalls).toHaveLength(2);
    expect(client.confluenceCalls[1]).toMatchObject({ cursor: "conf_cursor_1" });
    expect(result.statuses).toEqual(["created", "created", "created", "created"]);
    expect(store.snapshot()?.checkpoints.map((checkpoint) => checkpoint.connector)).toEqual(expect.arrayContaining(["jira", "confluence"]));
  });

  it("syncs GitLab items with comments", async () => {
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const client = createFakeClient({ gitlab: [gitLabPage()] });
    const worker = createEnterpriseComposioIngestion({ ingestionPipeline: pipeline, enterpriseClient: client });

    const result = await worker.syncEnterprise(
      baseInput({
        selectedSources: [
          {
            kind: "gitlab",
            scope: "gitlab:project:agent-platform",
            name: "agent-platform",
            teams: ["platform"],
            roles: ["admin", "reviewer", "operator", "agent"],
            sensitivity: "internal",
            coverage: { acl: true, delta: true, webhook: true }
          }
        ]
      })
    );

    expect(result.artifacts[0]).toMatchObject({
      connector: "gitlab",
      sourceObjectId: "gitlab:acct_enterprise:agent-platform:merge-request:77",
      source: { sourceType: "code" }
    });
    expect(result.artifacts[0].normalizedText).toContain("Comment gl-c1 by reviewer@example.com: Security checks passed.");
  });

  it("blocks sync for revoked enterprise connected accounts before client calls", async () => {
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const client = createFakeClient({ microsoft: [microsoftPage()] });
    const worker = createEnterpriseComposioIngestion({ ingestionPipeline: pipeline, enterpriseClient: client });

    await expect(
      worker.syncEnterprise(
        baseInput({
          connectedAccount: {
            id: "acct_enterprise",
            status: "revoked",
            principalId: "usr_admin"
          }
        })
      )
    ).rejects.toThrow(/revoked/i);

    expect(client.microsoftCalls).toHaveLength(0);
  });

  it("documents and blocks native fallback requirements when Composio coverage is insufficient", async () => {
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const client = createFakeClient({ microsoft: [microsoftPage()] });
    const worker = createEnterpriseComposioIngestion({ ingestionPipeline: pipeline, enterpriseClient: client });
    const input = baseInput({
      selectedSources: [
        {
          kind: "microsoft-sharepoint",
          scope: "microsoft:sharepoint:restricted-site",
          name: "Restricted SharePoint",
          teams: ["platform"],
          roles: ["admin", "reviewer"],
          sensitivity: "restricted",
          coverage: { acl: false, delta: true, webhook: false }
        }
      ],
      allowedScopes: ["microsoft:sharepoint:restricted-site"]
    });

    expect(worker.fallbackRequirements(input)).toEqual([
      {
        sourceKind: "microsoft-sharepoint",
        scope: "microsoft:sharepoint:restricted-site",
        requiredAdapter: "native",
        status: "blocked",
        missingCapabilities: ["acl", "webhook"],
        reason: "Composio coverage is missing acl, webhook fidelity for Restricted SharePoint."
      }
    ]);
    await expect(worker.syncEnterprise(input)).rejects.toThrow(/native fallback/i);
    expect(client.microsoftCalls).toHaveLength(0);
  });

  it("commits, reviews, merges, and queries enterprise-derived artifacts with citations", async () => {
    const token = `enterprise-derived-${Date.now()}`;
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const client = createFakeClient({ gitlab: [gitLabPage(`The ${token} rollout shipped`)] });
    const worker = createEnterpriseComposioIngestion({ ingestionPipeline: pipeline, enterpriseClient: client });
    const sync = await worker.syncEnterprise(
      baseInput({
        selectedSources: [
          {
            kind: "gitlab",
            scope: "gitlab:project:agent-platform",
            name: "agent-platform",
            teams: ["platform"],
            roles: ["admin", "reviewer", "operator", "agent"],
            sensitivity: "internal",
            coverage: { acl: true, delta: true, webhook: true }
          }
        ]
      })
    );
    const artifact = sync.artifacts[0];

    const commitResponse = await commitBrain(
      jsonRequest("/api/v1/brain/commit", {
        title: `Enterprise decision ${token}`,
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
        note: "Enterprise source evidence is sufficient."
      }, "PATCH"),
      params(committed.changeset.id)
    );
    const mergeResponse = await mergeChangeset(jsonRequest(`/api/v1/changesets/${committed.changeset.id}/merge`, {}), params(committed.changeset.id));
    expect(mergeResponse.status).toBe(200);

    const queryResponse = await queryBrain(
      jsonRequest("/api/v1/brain/query", {
        query: token,
        principalId: "usr_reviewer"
      })
    );
    const query = await queryResponse.json();

    expect(query.citations.map((item: { id: string }) => item.id)).toContain(committed.atom.id);
  });

  it("serves enterprise sync and status through API routes", async () => {
    const syncRoute = await import("../app/api/v1/ingestion/enterprise/sync/route");
    const statusRoute = await import("../app/api/v1/ingestion/enterprise/status/route");
    const response = await syncRoute.POST(
      jsonRequest("/api/v1/ingestion/enterprise/sync", {
        ...baseInput(),
        mockPages: { microsoft: [microsoftPage(), { items: [], nextCursor: undefined }] }
      })
    );
    const payload = await response.json();
    const status = await statusRoute.GET();
    const state = await status.json();

    expect(response.status).toBe(200);
    expect(payload.artifacts[0].connector).toBe("microsoft-outlook");
    expect(state.artifacts).toBeDefined();
  });
});
