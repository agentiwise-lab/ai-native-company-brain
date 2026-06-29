import { composioIngestionPipeline, type ComposioIngestionInput, type NormalizedComposioArtifact } from "./composio-ingestion";
import type { Principal, Sensitivity } from "./types";

type WorkConnectedAccountSnapshot = {
  id: string;
  status: "pending" | "active" | "revoked" | "errored";
  principalId: string;
};

export type WorkSourceSelection = {
  kind: "github" | "linear";
  scope: string;
  name: string;
  teams: string[];
  roles: Principal["role"][];
  sensitivity: Sensitivity;
};

export type WorkComment = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
};

export type GitHubWorkItem = {
  kind: "pull-request" | "issue" | "discussion";
  id: string;
  number?: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  status: string;
  labels: string[];
  updatedAt: string;
  body: string;
  comments: WorkComment[];
  deleted?: boolean;
  renamedFrom?: string;
};

export type LinearWorkItem = {
  id: string;
  identifier?: string;
  title: string;
  url: string;
  project: string;
  team: string;
  author: string;
  status: string;
  labels: string[];
  updatedAt: string;
  body: string;
  comments: WorkComment[];
  deleted?: boolean;
  renamedFrom?: string;
};

export type WorkPage<T> = {
  items: T[];
  nextCursor?: string;
};

export type WorkSyncInput = {
  principalId: string;
  mode: "backfill" | "incremental";
  connectedAccount: WorkConnectedAccountSnapshot;
  selectedSources: WorkSourceSelection[];
  allowedScopes?: string[];
  cursor?: string;
};

export type WorkSyncResult = {
  mode: WorkSyncInput["mode"];
  sources: WorkSourceSelection["kind"][];
  statuses: Array<"created" | "updated" | "duplicate">;
  artifacts: NormalizedComposioArtifact[];
};

export type WorkComposioClient = {
  fetchGitHub(input: WorkSyncInput): Promise<WorkPage<GitHubWorkItem>>;
  fetchLinear(input: WorkSyncInput): Promise<WorkPage<LinearWorkItem>>;
};

type WorkIngestionOptions = {
  ingestionPipeline?: typeof composioIngestionPipeline;
  workClient?: WorkComposioClient;
};

function defaultBaseUrl() {
  return process.env.COMPOSIO_BASE_URL ?? "https://backend.composio.dev";
}

function githubToolSlug() {
  return process.env.COMPOSIO_GITHUB_WORK_SYNC_TOOL ?? "GITHUB_LIST_PULL_REQUESTS";
}

function linearToolSlug() {
  return process.env.COMPOSIO_LINEAR_WORK_SYNC_TOOL ?? "LINEAR_LIST_ISSUES";
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Composio work sync failed with ${response.status}: ${text || response.statusText}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function recordValue(input: unknown) {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function arrayValue(input: unknown) {
  return Array.isArray(input) ? input : [];
}

function stringValue(input: unknown) {
  return typeof input === "string" ? input : undefined;
}

function dataPayload(payload: Record<string, unknown>) {
  return recordValue(payload.data ?? payload);
}

function nextCursorFromPayload(payload: Record<string, unknown>) {
  const data = dataPayload(payload);
  return stringValue(data.nextCursor) ?? stringValue(data.next_cursor) ?? stringValue(recordValue(data.pageInfo).endCursor);
}

function commentsFromPayload(input: unknown) {
  return arrayValue(input).map((comment) => {
    const record = recordValue(comment);
    return {
      id: stringValue(record.id) ?? "",
      author: stringValue(record.author) ?? stringValue(record.user) ?? "unknown",
      body: stringValue(record.body) ?? stringValue(record.text) ?? "",
      createdAt: stringValue(record.createdAt) ?? stringValue(record.created_at) ?? ""
    };
  });
}

function githubItemsFromPayload(payload: Record<string, unknown>) {
  const data = dataPayload(payload);
  const items = arrayValue(data.items).length > 0 ? arrayValue(data.items) : arrayValue(data.pull_requests);

  return items.map((item) => {
    const record = recordValue(item);
    return {
      kind: (stringValue(record.kind) as GitHubWorkItem["kind"] | undefined) ?? "pull-request",
      id: stringValue(record.id) ?? "",
      number: typeof record.number === "number" ? record.number : undefined,
      title: stringValue(record.title) ?? "GitHub work item",
      url: stringValue(record.url) ?? stringValue(record.html_url) ?? "",
      repo: stringValue(record.repo) ?? stringValue(record.repository) ?? "",
      author: stringValue(record.author) ?? stringValue(record.user) ?? "unknown",
      status: stringValue(record.status) ?? stringValue(record.state) ?? "open",
      labels: arrayValue(record.labels).map(String),
      updatedAt: stringValue(record.updatedAt) ?? stringValue(record.updated_at) ?? new Date().toISOString(),
      body: stringValue(record.body) ?? "",
      comments: commentsFromPayload(record.comments),
      deleted: record.deleted === true,
      renamedFrom: stringValue(record.renamedFrom) ?? stringValue(record.renamed_from)
    };
  });
}

function linearItemsFromPayload(payload: Record<string, unknown>) {
  const data = dataPayload(payload);
  const items = arrayValue(data.items).length > 0 ? arrayValue(data.items) : arrayValue(data.issues);

  return items.map((item) => {
    const record = recordValue(item);
    return {
      id: stringValue(record.id) ?? "",
      identifier: stringValue(record.identifier),
      title: stringValue(record.title) ?? "Linear issue",
      url: stringValue(record.url) ?? "",
      project: stringValue(record.project) ?? "",
      team: stringValue(record.team) ?? "",
      author: stringValue(record.author) ?? "unknown",
      status: stringValue(record.status) ?? stringValue(record.state) ?? "Todo",
      labels: arrayValue(record.labels).map(String),
      updatedAt: stringValue(record.updatedAt) ?? stringValue(record.updated_at) ?? new Date().toISOString(),
      body: stringValue(record.body) ?? stringValue(record.description) ?? "",
      comments: commentsFromPayload(record.comments),
      deleted: record.deleted === true,
      renamedFrom: stringValue(record.renamedFrom) ?? stringValue(record.renamed_from)
    };
  });
}

export function createComposioWorkClient(input: { apiKey?: string; baseUrl?: string; githubTool?: string; linearTool?: string } = {}): WorkComposioClient {
  const apiKey = input.apiKey ?? process.env.COMPOSIO_API_KEY;
  const baseUrl = input.baseUrl ?? defaultBaseUrl();

  async function execute(toolSlug: string, syncInput: WorkSyncInput, args: Record<string, unknown>) {
    if (!apiKey) {
      throw new Error("Composio API key is required for work sync.");
    }

    return readJson(
      await fetch(`${baseUrl.replace(/\/$/, "")}/api/v3.1/tools/execute/${toolSlug}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey
        },
        body: JSON.stringify({
          connected_account_id: syncInput.connectedAccount.id,
          user_id: syncInput.connectedAccount.principalId,
          arguments: args
        })
      })
    );
  }

  return {
    async fetchGitHub(syncInput) {
      const source = syncInput.selectedSources.find((candidate) => candidate.kind === "github");
      const payload = await execute(input.githubTool ?? githubToolSlug(), syncInput, {
        cursor: syncInput.cursor,
        scope: source?.scope,
        include_comments: true,
        include_discussions: true,
        limit: 100
      });
      return {
        items: githubItemsFromPayload(payload),
        nextCursor: nextCursorFromPayload(payload)
      };
    },
    async fetchLinear(syncInput) {
      const source = syncInput.selectedSources.find((candidate) => candidate.kind === "linear");
      const payload = await execute(input.linearTool ?? linearToolSlug(), syncInput, {
        cursor: syncInput.cursor,
        scope: source?.scope,
        include_comments: true,
        include_project: true,
        limit: 100
      });
      return {
        items: linearItemsFromPayload(payload),
        nextCursor: nextCursorFromPayload(payload)
      };
    }
  };
}

function assertSyncAllowed(input: WorkSyncInput) {
  if (input.connectedAccount.status === "revoked") {
    throw new Error(`Work connected account ${input.connectedAccount.id} is revoked.`);
  }
  if (input.connectedAccount.status !== "active") {
    throw new Error(`Work connected account ${input.connectedAccount.id} is not active.`);
  }
  if (input.selectedSources.length === 0) {
    throw new Error("At least one GitHub or Linear source must be selected.");
  }

  const allowedScopes = input.allowedScopes ? new Set(input.allowedScopes) : undefined;
  const blocked = allowedScopes ? input.selectedSources.find((source) => !allowedScopes.has(source.scope)) : undefined;
  if (blocked) {
    throw new Error(`Missing permission for selected source ${blocked.scope}.`);
  }
}

function dedupeComments(comments: WorkComment[]) {
  const seen = new Set<string>();
  return comments.filter((comment) => {
    const key = comment.id || `${comment.author}:${comment.createdAt}:${comment.body}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sourceObjectIdForGitHub(input: WorkSyncInput, item: GitHubWorkItem) {
  return `github:${input.connectedAccount.id}:${item.repo}:${item.kind}:${item.number ?? item.id}`;
}

function normalizeGitHubText(item: GitHubWorkItem, source: WorkSourceSelection) {
  const comments = dedupeComments(item.comments);
  return [
    `Title: ${item.title}`,
    `Repo: ${item.repo}`,
    `Kind: ${item.kind}`,
    `Status: ${item.status}`,
    `Author: ${item.author}`,
    `Labels: ${item.labels.join(", ")}`,
    `Scope: ${source.scope}`,
    `Updated: ${item.updatedAt}`,
    `Deleted: ${item.deleted === true}`,
    item.renamedFrom ? `Renamed from: ${item.renamedFrom}` : "",
    `Body: ${item.body}`,
    ...comments.map((comment) => `Comment ${comment.id} by ${comment.author}: ${comment.body}`)
  ].filter(Boolean).join("\n");
}

function normalizeLinearText(item: LinearWorkItem, source: WorkSourceSelection) {
  const comments = dedupeComments(item.comments);
  return [
    `Title: ${item.title}`,
    `Identifier: ${item.identifier ?? item.id}`,
    `Project: ${item.project}`,
    `Team: ${item.team}`,
    `Status: ${item.status}`,
    `Author: ${item.author}`,
    `Labels: ${item.labels.join(", ")}`,
    `Scope: ${source.scope}`,
    `Updated: ${item.updatedAt}`,
    `Deleted: ${item.deleted === true}`,
    item.renamedFrom ? `Renamed from: ${item.renamedFrom}` : "",
    `Body: ${item.body}`,
    ...comments.map((comment) => `Comment ${comment.id} by ${comment.author}: ${comment.body}`)
  ].filter(Boolean).join("\n");
}

function githubInput(input: WorkSyncInput, source: WorkSourceSelection, item: GitHubWorkItem, cursor?: string): ComposioIngestionInput {
  return {
    connector: "github",
    sourceType: "code",
    sourceObjectId: sourceObjectIdForGitHub(input, item),
    sourceUpdatedAt: item.updatedAt,
    principalId: input.principalId,
    connectedAccount: input.connectedAccount,
    provenanceUrl: item.url,
    title: item.title,
    normalizedText: normalizeGitHubText(item, source),
    raw: {
      kind: "github",
      item: {
        ...item,
        comments: dedupeComments(item.comments)
      },
      mode: input.mode,
      source
    },
    acl: {
      teams: source.teams,
      roles: source.roles,
      sensitivity: source.sensitivity
    },
    checkpoint: {
      cursor: cursor ?? item.updatedAt
    }
  };
}

function linearInput(input: WorkSyncInput, source: WorkSourceSelection, item: LinearWorkItem, cursor?: string): ComposioIngestionInput {
  return {
    connector: "linear",
    sourceType: "ticket",
    sourceObjectId: `linear:${input.connectedAccount.id}:${item.identifier ?? item.id}`,
    sourceUpdatedAt: item.updatedAt,
    principalId: input.principalId,
    connectedAccount: input.connectedAccount,
    provenanceUrl: item.url,
    title: item.title,
    normalizedText: normalizeLinearText(item, source),
    raw: {
      kind: "linear",
      item: {
        ...item,
        comments: dedupeComments(item.comments)
      },
      mode: input.mode,
      source
    },
    acl: {
      teams: source.teams,
      roles: source.roles,
      sensitivity: source.sensitivity
    },
    checkpoint: {
      cursor: cursor ?? item.updatedAt
    }
  };
}

export function createWorkComposioIngestion(options: WorkIngestionOptions = {}) {
  const ingestionPipeline = options.ingestionPipeline ?? composioIngestionPipeline;
  const workClient = options.workClient ?? createComposioWorkClient();

  async function checkpointCursor(connector: "github" | "linear", input: WorkSyncInput) {
    if (input.mode !== "incremental" || input.cursor) {
      return input.cursor;
    }

    const state = await ingestionPipeline.getState();
    const checkpoint = state.checkpoints.find((candidate) => candidate.id === `${connector}:${input.connectedAccount.id}`);
    return checkpoint?.cursor;
  }

  return {
    async syncState() {
      const state = await ingestionPipeline.getState();
      return {
        artifacts: state.artifacts.filter((artifact) => artifact.connector === "github" || artifact.connector === "linear"),
        checkpoints: state.checkpoints.filter((checkpoint) => checkpoint.connector === "github" || checkpoint.connector === "linear"),
        runs: state.runs.filter((run) => run.connector === "github" || run.connector === "linear"),
        auditEvents: state.auditEvents.filter((event) => event.metadata.connector === "github" || event.metadata.connector === "linear")
      };
    },

    async syncWork(input: WorkSyncInput): Promise<WorkSyncResult> {
      assertSyncAllowed(input);
      const statuses: WorkSyncResult["statuses"] = [];
      const artifacts: NormalizedComposioArtifact[] = [];

      for (const source of input.selectedSources) {
        let cursor = await checkpointCursor(source.kind, input);
        let pageCount = 0;

        do {
          pageCount += 1;
          if (pageCount > 25) {
            throw new Error(`Pagination limit exceeded for ${source.kind}.`);
          }

          if (source.kind === "github") {
            const page = await workClient.fetchGitHub({ ...input, selectedSources: [source], cursor });
            for (const item of page.items) {
              const ingested = await ingestionPipeline.ingestComposioResult(githubInput(input, source, item, page.nextCursor));
              statuses.push(ingested.status);
              artifacts.push(ingested.artifact);
            }
            cursor = page.nextCursor;
          } else {
            const page = await workClient.fetchLinear({ ...input, selectedSources: [source], cursor });
            for (const item of page.items) {
              const ingested = await ingestionPipeline.ingestComposioResult(linearInput(input, source, item, page.nextCursor));
              statuses.push(ingested.status);
              artifacts.push(ingested.artifact);
            }
            cursor = page.nextCursor;
          }
        } while (cursor);
      }

      return {
        mode: input.mode,
        sources: input.selectedSources.map((source) => source.kind),
        statuses,
        artifacts
      };
    }
  };
}

export const workComposioIngestion = createWorkComposioIngestion();
