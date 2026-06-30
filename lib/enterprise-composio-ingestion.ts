import { composioIngestionPipeline, type ComposioIngestionInput, type NormalizedComposioArtifact } from "./composio-ingestion";
import type { Principal, Sensitivity, SourceArtifact } from "./types";

type EnterpriseConnectedAccountSnapshot = {
  id: string;
  status: "pending" | "active" | "revoked" | "errored";
  principalId: string;
};

export type MicrosoftSourceKind = "microsoft-teams" | "microsoft-outlook" | "microsoft-sharepoint" | "microsoft-onedrive";
export type EnterpriseSourceKind = MicrosoftSourceKind | "jira" | "confluence" | "gitlab";
export type CoverageCapability = "acl" | "delta" | "webhook";

export type EnterpriseSourceSelection = {
  kind: EnterpriseSourceKind;
  scope: string;
  name: string;
  teams: string[];
  roles: Principal["role"][];
  sensitivity: Sensitivity;
  coverage?: Partial<Record<CoverageCapability, boolean>>;
  nativeFallbackApproved?: boolean;
};

export type EnterpriseComment = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
};

export type MicrosoftEnterpriseItem = {
  id: string;
  kind: "teams-message" | "outlook-email" | "sharepoint-page" | "onedrive-file";
  title: string;
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  body: string;
  structure: Record<string, unknown>;
  aclMetadata: Record<string, unknown>;
};

export type JiraEnterpriseItem = {
  id: string;
  key: string;
  title: string;
  url: string;
  project: string;
  author: string;
  status: string;
  updatedAt: string;
  body: string;
  comments: EnterpriseComment[];
};

export type ConfluenceEnterpriseItem = {
  id: string;
  title: string;
  url: string;
  space: string;
  author: string;
  updatedAt: string;
  body: string;
  comments: EnterpriseComment[];
};

export type GitLabEnterpriseItem = {
  kind: "merge-request" | "issue" | "commit";
  id: string;
  iid?: number;
  title: string;
  url: string;
  project: string;
  author: string;
  status: string;
  updatedAt: string;
  body: string;
  comments: EnterpriseComment[];
};

export type EnterprisePage<T> = {
  items: T[];
  nextCursor?: string;
};

export type EnterpriseSyncInput = {
  principalId: string;
  mode: "backfill" | "incremental";
  connectedAccount: EnterpriseConnectedAccountSnapshot;
  selectedSources: EnterpriseSourceSelection[];
  allowedScopes?: string[];
  cursor?: string;
};

export type EnterpriseFallbackRequirement = {
  sourceKind: EnterpriseSourceKind;
  scope: string;
  requiredAdapter: "native";
  status: "blocked" | "approved";
  missingCapabilities: CoverageCapability[];
  reason: string;
};

export type EnterpriseSyncResult = {
  mode: EnterpriseSyncInput["mode"];
  sources: EnterpriseSourceKind[];
  statuses: Array<"created" | "updated" | "duplicate">;
  artifacts: NormalizedComposioArtifact[];
  fallbackRequirements: EnterpriseFallbackRequirement[];
};

export type EnterpriseComposioClient = {
  fetchMicrosoft(input: EnterpriseSyncInput): Promise<EnterprisePage<MicrosoftEnterpriseItem>>;
  fetchJira(input: EnterpriseSyncInput): Promise<EnterprisePage<JiraEnterpriseItem>>;
  fetchConfluence(input: EnterpriseSyncInput): Promise<EnterprisePage<ConfluenceEnterpriseItem>>;
  fetchGitLab(input: EnterpriseSyncInput): Promise<EnterprisePage<GitLabEnterpriseItem>>;
};

type EnterpriseIngestionOptions = {
  ingestionPipeline?: typeof composioIngestionPipeline;
  enterpriseClient?: EnterpriseComposioClient;
};

const enterpriseConnectors = new Set<string>([
  "microsoft-teams",
  "microsoft-outlook",
  "microsoft-sharepoint",
  "microsoft-onedrive",
  "jira",
  "confluence",
  "gitlab"
]);

const requiredCoverage: CoverageCapability[] = ["acl", "delta", "webhook"];

function defaultBaseUrl() {
  return process.env.COMPOSIO_BASE_URL ?? "https://backend.composio.dev";
}

function toolSlug(kind: EnterpriseSourceKind) {
  const envKey = `COMPOSIO_${kind.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_SYNC_TOOL`;
  return process.env[envKey] ?? `${kind.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_SYNC`;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Composio enterprise sync failed with ${response.status}: ${text || response.statusText}`);
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

function numberValue(input: unknown) {
  return typeof input === "number" ? input : undefined;
}

function dataPayload(payload: Record<string, unknown>) {
  return recordValue(payload.data ?? payload);
}

function itemsPayload(payload: Record<string, unknown>) {
  const data = dataPayload(payload);
  return arrayValue(data.items).length > 0
    ? arrayValue(data.items)
    : arrayValue(data.records).length > 0
      ? arrayValue(data.records)
      : arrayValue(data.results);
}

function nextCursorFromPayload(payload: Record<string, unknown>) {
  const data = dataPayload(payload);
  return stringValue(data.nextCursor) ?? stringValue(data.next_cursor) ?? stringValue(recordValue(data.pageInfo).endCursor);
}

function commentsFromPayload(input: unknown): EnterpriseComment[] {
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

function microsoftItemsFromPayload(payload: Record<string, unknown>): MicrosoftEnterpriseItem[] {
  return itemsPayload(payload).map((item) => {
    const record = recordValue(item);
    return {
      id: stringValue(record.id) ?? "",
      kind: (stringValue(record.kind) as MicrosoftEnterpriseItem["kind"] | undefined) ?? "outlook-email",
      title: stringValue(record.title) ?? stringValue(record.subject) ?? stringValue(record.name) ?? "Microsoft source item",
      url: stringValue(record.url) ?? stringValue(record.webUrl) ?? stringValue(record.web_url) ?? "",
      author: stringValue(record.author) ?? stringValue(record.from) ?? stringValue(record.createdBy) ?? "unknown",
      createdAt: stringValue(record.createdAt) ?? stringValue(record.created_at) ?? new Date().toISOString(),
      updatedAt: stringValue(record.updatedAt) ?? stringValue(record.updated_at) ?? stringValue(record.modifiedAt) ?? new Date().toISOString(),
      body: stringValue(record.body) ?? stringValue(record.text) ?? stringValue(record.content) ?? "",
      structure: recordValue(record.structure),
      aclMetadata: recordValue(record.aclMetadata ?? record.acl_metadata ?? record.permissions)
    };
  });
}

function jiraItemsFromPayload(payload: Record<string, unknown>): JiraEnterpriseItem[] {
  return itemsPayload(payload).map((item) => {
    const record = recordValue(item);
    return {
      id: stringValue(record.id) ?? "",
      key: stringValue(record.key) ?? stringValue(record.identifier) ?? "",
      title: stringValue(record.title) ?? stringValue(record.summary) ?? "Jira issue",
      url: stringValue(record.url) ?? "",
      project: stringValue(record.project) ?? "",
      author: stringValue(record.author) ?? stringValue(record.reporter) ?? "unknown",
      status: stringValue(record.status) ?? "unknown",
      updatedAt: stringValue(record.updatedAt) ?? stringValue(record.updated_at) ?? new Date().toISOString(),
      body: stringValue(record.body) ?? stringValue(record.description) ?? "",
      comments: commentsFromPayload(record.comments)
    };
  });
}

function confluenceItemsFromPayload(payload: Record<string, unknown>): ConfluenceEnterpriseItem[] {
  return itemsPayload(payload).map((item) => {
    const record = recordValue(item);
    return {
      id: stringValue(record.id) ?? "",
      title: stringValue(record.title) ?? "Confluence page",
      url: stringValue(record.url) ?? stringValue(record.webUrl) ?? "",
      space: stringValue(record.space) ?? "",
      author: stringValue(record.author) ?? stringValue(record.createdBy) ?? "unknown",
      updatedAt: stringValue(record.updatedAt) ?? stringValue(record.updated_at) ?? new Date().toISOString(),
      body: stringValue(record.body) ?? stringValue(record.text) ?? "",
      comments: commentsFromPayload(record.comments)
    };
  });
}

function gitLabItemsFromPayload(payload: Record<string, unknown>): GitLabEnterpriseItem[] {
  return itemsPayload(payload).map((item) => {
    const record = recordValue(item);
    return {
      kind: (stringValue(record.kind) as GitLabEnterpriseItem["kind"] | undefined) ?? "merge-request",
      id: stringValue(record.id) ?? "",
      iid: numberValue(record.iid) ?? numberValue(record.number),
      title: stringValue(record.title) ?? "GitLab item",
      url: stringValue(record.url) ?? stringValue(record.web_url) ?? "",
      project: stringValue(record.project) ?? stringValue(record.repository) ?? "",
      author: stringValue(record.author) ?? stringValue(record.user) ?? "unknown",
      status: stringValue(record.status) ?? stringValue(record.state) ?? "open",
      updatedAt: stringValue(record.updatedAt) ?? stringValue(record.updated_at) ?? new Date().toISOString(),
      body: stringValue(record.body) ?? stringValue(record.description) ?? "",
      comments: commentsFromPayload(record.comments)
    };
  });
}

export function createComposioEnterpriseClient(input: { apiKey?: string; baseUrl?: string } = {}): EnterpriseComposioClient {
  const apiKey = input.apiKey ?? process.env.COMPOSIO_API_KEY;
  const baseUrl = input.baseUrl ?? defaultBaseUrl();

  async function execute(kind: EnterpriseSourceKind, syncInput: EnterpriseSyncInput) {
    if (!apiKey) {
      throw new Error("Composio API key is required for enterprise sync.");
    }
    const source = syncInput.selectedSources[0];
    return readJson(
      await fetch(`${baseUrl.replace(/\/$/, "")}/api/v3.1/tools/execute/${toolSlug(kind)}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey
        },
        body: JSON.stringify({
          connected_account_id: syncInput.connectedAccount.id,
          user_id: syncInput.connectedAccount.principalId,
          arguments: {
            cursor: syncInput.cursor,
            scope: source?.scope,
            source_kind: source?.kind,
            include_acl: true,
            include_delta: true,
            include_webhook_metadata: true,
            include_comments: true,
            limit: 100
          }
        })
      })
    );
  }

  return {
    async fetchMicrosoft(syncInput) {
      const payload = await execute(syncInput.selectedSources[0].kind, syncInput);
      return { items: microsoftItemsFromPayload(payload), nextCursor: nextCursorFromPayload(payload) };
    },
    async fetchJira(syncInput) {
      const payload = await execute("jira", syncInput);
      return { items: jiraItemsFromPayload(payload), nextCursor: nextCursorFromPayload(payload) };
    },
    async fetchConfluence(syncInput) {
      const payload = await execute("confluence", syncInput);
      return { items: confluenceItemsFromPayload(payload), nextCursor: nextCursorFromPayload(payload) };
    },
    async fetchGitLab(syncInput) {
      const payload = await execute("gitlab", syncInput);
      return { items: gitLabItemsFromPayload(payload), nextCursor: nextCursorFromPayload(payload) };
    }
  };
}

function isMicrosoft(kind: EnterpriseSourceKind): kind is MicrosoftSourceKind {
  return kind.startsWith("microsoft-");
}

function connectorForSource(source: EnterpriseSourceSelection) {
  return source.kind;
}

function sourceTypeFor(source: EnterpriseSourceSelection, item?: MicrosoftEnterpriseItem): SourceArtifact["sourceType"] {
  if (source.kind === "microsoft-outlook" || item?.kind === "outlook-email") {
    return "email";
  }
  if (source.kind === "microsoft-teams" || item?.kind === "teams-message") {
    return "docs";
  }
  if (source.kind === "jira") {
    return "ticket";
  }
  if (source.kind === "gitlab") {
    return "code";
  }
  return "docs";
}

function metadataLines(prefix: string, metadata: Record<string, unknown>) {
  return Object.entries(metadata).map(([key, value]) => {
    const rendered = Array.isArray(value) ? value.join(", ") : String(value);
    return `${prefix} ${key}: ${rendered}`;
  });
}

function dedupeComments(comments: EnterpriseComment[]) {
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

function normalizeMicrosoft(item: MicrosoftEnterpriseItem, source: EnterpriseSourceSelection) {
  return [
    `Title: ${item.title}`,
    `Kind: ${item.kind}`,
    `Author: ${item.author}`,
    `Created: ${item.createdAt}`,
    `Updated: ${item.updatedAt}`,
    `Scope: ${source.scope}`,
    ...metadataLines("Structure", item.structure),
    ...metadataLines("ACL", item.aclMetadata),
    `Body: ${item.body}`
  ].filter(Boolean).join("\n");
}

function normalizeJira(item: JiraEnterpriseItem, source: EnterpriseSourceSelection) {
  const comments = dedupeComments(item.comments);
  return [
    `Title: ${item.title}`,
    `Key: ${item.key}`,
    `Project: ${item.project}`,
    `Status: ${item.status}`,
    `Author: ${item.author}`,
    `Updated: ${item.updatedAt}`,
    `Scope: ${source.scope}`,
    `Body: ${item.body}`,
    ...comments.map((comment) => `Comment ${comment.id} by ${comment.author}: ${comment.body}`)
  ].filter(Boolean).join("\n");
}

function normalizeConfluence(item: ConfluenceEnterpriseItem, source: EnterpriseSourceSelection) {
  const comments = dedupeComments(item.comments);
  return [
    `Title: ${item.title}`,
    `Space: ${item.space}`,
    `Author: ${item.author}`,
    `Updated: ${item.updatedAt}`,
    `Scope: ${source.scope}`,
    `Body: ${item.body}`,
    ...comments.map((comment) => `Comment ${comment.id} by ${comment.author}: ${comment.body}`)
  ].filter(Boolean).join("\n");
}

function normalizeGitLab(item: GitLabEnterpriseItem, source: EnterpriseSourceSelection) {
  const comments = dedupeComments(item.comments);
  return [
    `Title: ${item.title}`,
    `Project: ${item.project}`,
    `Kind: ${item.kind}`,
    `Status: ${item.status}`,
    `Author: ${item.author}`,
    `Updated: ${item.updatedAt}`,
    `Scope: ${source.scope}`,
    `Body: ${item.body}`,
    ...comments.map((comment) => `Comment ${comment.id} by ${comment.author}: ${comment.body}`)
  ].filter(Boolean).join("\n");
}

function baseInput(
  input: EnterpriseSyncInput,
  source: EnterpriseSourceSelection,
  item: {
    id: string;
    title: string;
    url: string;
    updatedAt: string;
  },
  normalizedText: string,
  raw: Record<string, unknown>,
  cursor?: string,
  microsoftItem?: MicrosoftEnterpriseItem
): ComposioIngestionInput {
  return {
    connector: connectorForSource(source),
    sourceType: sourceTypeFor(source, microsoftItem),
    sourceObjectId: `${connectorForSource(source)}:${input.connectedAccount.id}:${item.id}`,
    sourceUpdatedAt: item.updatedAt,
    principalId: input.principalId,
    connectedAccount: input.connectedAccount,
    provenanceUrl: item.url,
    title: item.title,
    normalizedText,
    raw,
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

function microsoftInput(input: EnterpriseSyncInput, source: EnterpriseSourceSelection, item: MicrosoftEnterpriseItem, cursor?: string) {
  return baseInput(
    input,
    source,
    item,
    normalizeMicrosoft(item, source),
    { kind: source.kind, item, mode: input.mode, source },
    cursor,
    item
  );
}

function jiraInput(input: EnterpriseSyncInput, source: EnterpriseSourceSelection, item: JiraEnterpriseItem, cursor?: string) {
  return baseInput(input, source, item, normalizeJira(item, source), { kind: "jira", item, mode: input.mode, source }, cursor);
}

function confluenceInput(input: EnterpriseSyncInput, source: EnterpriseSourceSelection, item: ConfluenceEnterpriseItem, cursor?: string) {
  return baseInput(input, source, item, normalizeConfluence(item, source), { kind: "confluence", item, mode: input.mode, source }, cursor);
}

function gitLabInput(input: EnterpriseSyncInput, source: EnterpriseSourceSelection, item: GitLabEnterpriseItem, cursor?: string): ComposioIngestionInput {
  const sourceObject = {
    id: `${item.project}:${item.kind}:${item.iid ?? item.id}`,
    title: item.title,
    url: item.url,
    updatedAt: item.updatedAt
  };
  return {
    ...baseInput(input, source, sourceObject, normalizeGitLab(item, source), { kind: "gitlab", item, mode: input.mode, source }, cursor),
    sourceObjectId: `gitlab:${input.connectedAccount.id}:${item.project}:${item.kind}:${item.iid ?? item.id}`
  };
}

function fallbackRequirementsFor(input: EnterpriseSyncInput): EnterpriseFallbackRequirement[] {
  return input.selectedSources.flatMap((source) => {
    const missing = requiredCoverage.filter((capability) => source.coverage?.[capability] === false);
    if (missing.length === 0) {
      return [];
    }
    return [
      {
        sourceKind: source.kind,
        scope: source.scope,
        requiredAdapter: "native" as const,
        status: source.nativeFallbackApproved ? "approved" as const : "blocked" as const,
        missingCapabilities: missing,
        reason: `Composio coverage is missing ${missing.join(", ")} fidelity for ${source.name}.`
      }
    ];
  });
}

function assertSyncAllowed(input: EnterpriseSyncInput) {
  if (input.connectedAccount.status === "revoked") {
    throw new Error(`Enterprise connected account ${input.connectedAccount.id} is revoked.`);
  }
  if (input.connectedAccount.status !== "active") {
    throw new Error(`Enterprise connected account ${input.connectedAccount.id} is not active.`);
  }
  if (input.selectedSources.length === 0) {
    throw new Error("At least one enterprise source must be selected.");
  }
  const allowedScopes = input.allowedScopes ? new Set(input.allowedScopes) : undefined;
  const blockedScope = allowedScopes ? input.selectedSources.find((source) => !allowedScopes.has(source.scope)) : undefined;
  if (blockedScope) {
    throw new Error(`Missing permission for selected source ${blockedScope.scope}.`);
  }
  const blockedFallback = fallbackRequirementsFor(input).find((requirement) => requirement.status === "blocked");
  if (blockedFallback) {
    throw new Error(`Native fallback is required before syncing ${blockedFallback.scope}: ${blockedFallback.reason}`);
  }
}

export function createEnterpriseComposioIngestion(options: EnterpriseIngestionOptions = {}) {
  const ingestionPipeline = options.ingestionPipeline ?? composioIngestionPipeline;
  const enterpriseClient = options.enterpriseClient ?? createComposioEnterpriseClient();

  async function checkpointCursor(connector: string, input: EnterpriseSyncInput) {
    if (input.mode !== "incremental" || input.cursor) {
      return input.cursor;
    }
    const state = await ingestionPipeline.getState();
    const checkpoint = state.checkpoints.find((candidate) => candidate.id === `${connector}:${input.connectedAccount.id}`);
    return checkpoint?.cursor;
  }

  async function ingestPage(input: EnterpriseSyncInput, source: EnterpriseSourceSelection, cursor: string | undefined) {
    const statuses: EnterpriseSyncResult["statuses"] = [];
    const artifacts: NormalizedComposioArtifact[] = [];
    const connector = connectorForSource(source);

    if (isMicrosoft(source.kind)) {
      const page = await enterpriseClient.fetchMicrosoft({ ...input, selectedSources: [source], cursor });
      for (const item of page.items) {
        const ingested = await ingestionPipeline.ingestComposioResult(microsoftInput(input, source, item, page.nextCursor));
        statuses.push(ingested.status);
        artifacts.push(ingested.artifact);
      }
      return { statuses, artifacts, nextCursor: page.nextCursor };
    }

    if (source.kind === "jira") {
      const page = await enterpriseClient.fetchJira({ ...input, selectedSources: [source], cursor });
      for (const item of page.items) {
        const ingested = await ingestionPipeline.ingestComposioResult(jiraInput(input, source, item, page.nextCursor));
        statuses.push(ingested.status);
        artifacts.push(ingested.artifact);
      }
      return { statuses, artifacts, nextCursor: page.nextCursor };
    }

    if (source.kind === "confluence") {
      const page = await enterpriseClient.fetchConfluence({ ...input, selectedSources: [source], cursor });
      for (const item of page.items) {
        const ingested = await ingestionPipeline.ingestComposioResult(confluenceInput(input, source, item, page.nextCursor));
        statuses.push(ingested.status);
        artifacts.push(ingested.artifact);
      }
      return { statuses, artifacts, nextCursor: page.nextCursor };
    }

    const page = await enterpriseClient.fetchGitLab({ ...input, selectedSources: [source], cursor });
    for (const item of page.items) {
      const ingested = await ingestionPipeline.ingestComposioResult(gitLabInput(input, source, item, page.nextCursor));
      statuses.push(ingested.status);
      artifacts.push(ingested.artifact);
    }
    return { statuses, artifacts, nextCursor: page.nextCursor, connector };
  }

  return {
    fallbackRequirements(input: EnterpriseSyncInput) {
      return fallbackRequirementsFor(input);
    },

    async syncState() {
      const state = await ingestionPipeline.getState();
      return {
        artifacts: state.artifacts.filter((artifact) => enterpriseConnectors.has(artifact.connector)),
        checkpoints: state.checkpoints.filter((checkpoint) => enterpriseConnectors.has(checkpoint.connector)),
        runs: state.runs.filter((run) => enterpriseConnectors.has(run.connector)),
        auditEvents: state.auditEvents.filter((event) => enterpriseConnectors.has(String(event.metadata.connector)))
      };
    },

    async syncEnterprise(input: EnterpriseSyncInput): Promise<EnterpriseSyncResult> {
      assertSyncAllowed(input);
      const fallbackRequirements = fallbackRequirementsFor(input);
      const statuses: EnterpriseSyncResult["statuses"] = [];
      const artifacts: NormalizedComposioArtifact[] = [];

      for (const source of input.selectedSources) {
        let cursor = await checkpointCursor(connectorForSource(source), input);
        let pageCount = 0;

        do {
          pageCount += 1;
          if (pageCount > 25) {
            throw new Error(`Pagination limit exceeded for ${source.kind}.`);
          }
          const page = await ingestPage(input, source, cursor);
          statuses.push(...page.statuses);
          artifacts.push(...page.artifacts);
          cursor = page.nextCursor;
        } while (cursor);
      }

      return {
        mode: input.mode,
        sources: input.selectedSources.map((source) => source.kind),
        statuses,
        artifacts,
        fallbackRequirements
      };
    }
  };
}

export const enterpriseComposioIngestion = createEnterpriseComposioIngestion();
