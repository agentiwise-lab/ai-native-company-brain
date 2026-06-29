import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { composioIngestionPipeline, type ComposioIngestionInput, type NormalizedComposioArtifact } from "./composio-ingestion";
import type { Principal, Sensitivity, SourceArtifact } from "./types";

type ConnectedAccountSnapshot = {
  id: string;
  status: "pending" | "active" | "revoked" | "errored";
  principalId: string;
};

export type NotionSourceSelection = {
  id: string;
  kind: "page" | "database";
  name: string;
  teams: string[];
  roles: Principal["role"][];
  sensitivity: Sensitivity;
};

export type NotionSyncInput = {
  principalId: string;
  mode: "backfill" | "incremental";
  connectedAccount: ConnectedAccountSnapshot;
  selectedSources: NotionSourceSelection[];
  allowedSourceIds?: string[];
  cursor?: string;
};

export type NotionBlock = {
  id: string;
  type: string;
  text: string;
  unsupported?: boolean;
};

export type NotionComment = {
  id: string;
  author: string;
  text: string;
  createdAt: string;
};

export type NotionPage = {
  id: string;
  title: string;
  url: string;
  workspace: string;
  database?: string;
  author: string;
  updatedAt: string;
  blocks: NotionBlock[];
  comments: NotionComment[];
};

export type NotionResult = {
  pages: NotionPage[];
  nextCursor?: string;
};

export type WebhookPayload = {
  sourceId: string;
  sourceType: SourceArtifact["sourceType"];
  title: string;
  provenanceUrl: string;
  principalId: string;
  content: string;
  raw: Record<string, unknown>;
  acl: {
    teams: string[];
    roles: Principal["role"][];
    sensitivity: Sensitivity;
  };
};

export type WebhookIngestionInput = {
  secret: string;
  signature: string;
  payload: WebhookPayload;
};

export type FlexibleState = {
  disabledSources: string[];
  replays: Array<{ sourceId: string; replayedAt: string }>;
};

export type FlexibleIngestionStore = {
  read(): Promise<FlexibleState | null>;
  write(state: FlexibleState): Promise<void>;
};

export type NotionComposioClient = {
  fetchNotion(input: NotionSyncInput): Promise<NotionResult>;
};

type FlexibleIngestionOptions = {
  ingestionPipeline?: typeof composioIngestionPipeline;
  notionClient?: NotionComposioClient;
  store?: FlexibleIngestionStore;
  now?: () => string;
};

type NotionSyncResult = {
  statuses: Array<"created" | "updated" | "duplicate">;
  artifacts: NormalizedComposioArtifact[];
};

function defaultState(): FlexibleState {
  return { disabledSources: [], replays: [] };
}

function defaultStatePath() {
  return process.env.FLEXIBLE_INGESTION_STATE_PATH ?? join(process.cwd(), "data", "flexible-ingestion-state.json");
}

function createFileStore(path = defaultStatePath()): FlexibleIngestionStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as FlexibleState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultBaseUrl() {
  return process.env.COMPOSIO_BASE_URL ?? "https://backend.composio.dev";
}

function notionToolSlug() {
  return process.env.COMPOSIO_NOTION_SYNC_TOOL ?? "NOTION_SEARCH_PAGES";
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Composio Notion sync failed with ${response.status}: ${text || response.statusText}`);
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

function pagesFromPayload(payload: Record<string, unknown>): NotionPage[] {
  const data = recordValue(payload.data ?? payload);
  const pages = arrayValue(data.pages).length > 0 ? arrayValue(data.pages) : arrayValue(data.items);
  return pages.map((page) => {
    const record = recordValue(page);
    return {
      id: stringValue(record.id) ?? "",
      title: stringValue(record.title) ?? "Notion page",
      url: stringValue(record.url) ?? "",
      workspace: stringValue(record.workspace) ?? "",
      database: stringValue(record.database),
      author: stringValue(record.author) ?? "unknown",
      updatedAt: stringValue(record.updatedAt) ?? stringValue(record.updated_at) ?? new Date().toISOString(),
      blocks: arrayValue(record.blocks).map((block) => {
        const blockRecord = recordValue(block);
        return {
          id: stringValue(blockRecord.id) ?? "",
          type: stringValue(blockRecord.type) ?? "unknown",
          text: stringValue(blockRecord.text) ?? "",
          unsupported: blockRecord.unsupported === true
        };
      }),
      comments: arrayValue(record.comments).map((comment) => {
        const commentRecord = recordValue(comment);
        return {
          id: stringValue(commentRecord.id) ?? "",
          author: stringValue(commentRecord.author) ?? "unknown",
          text: stringValue(commentRecord.text) ?? "",
          createdAt: stringValue(commentRecord.createdAt) ?? stringValue(commentRecord.created_at) ?? ""
        };
      })
    };
  });
}

function nextCursorFromPayload(payload: Record<string, unknown>) {
  const data = recordValue(payload.data ?? payload);
  return stringValue(data.nextCursor) ?? stringValue(data.next_cursor);
}

export function createComposioNotionClient(input: { apiKey?: string; baseUrl?: string; toolSlug?: string } = {}): NotionComposioClient {
  const apiKey = input.apiKey ?? process.env.COMPOSIO_API_KEY;
  const baseUrl = input.baseUrl ?? defaultBaseUrl();
  const toolSlug = input.toolSlug ?? notionToolSlug();

  return {
    async fetchNotion(syncInput) {
      if (!apiKey) {
        throw new Error("Composio API key is required for Notion sync.");
      }

      const payload = await readJson(
        await fetch(`${baseUrl.replace(/\/$/, "")}/api/v3.1/tools/execute/${toolSlug}`, {
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
              source_ids: syncInput.selectedSources.map((source) => source.id),
              include_comments: true,
              include_blocks: true,
              limit: 100
            }
          })
        })
      );

      return {
        pages: pagesFromPayload(payload),
        nextCursor: nextCursorFromPayload(payload)
      };
    }
  };
}

function assertNotionAllowed(input: NotionSyncInput) {
  if (input.connectedAccount.status === "revoked") {
    throw new Error(`Notion connected account ${input.connectedAccount.id} is revoked.`);
  }
  if (input.connectedAccount.status !== "active") {
    throw new Error(`Notion connected account ${input.connectedAccount.id} is not active.`);
  }
  const allowed = input.allowedSourceIds ? new Set(input.allowedSourceIds) : undefined;
  const blocked = allowed ? input.selectedSources.find((source) => !allowed.has(source.id)) : undefined;
  if (blocked) {
    throw new Error(`Notion source ${blocked.id} is not allowed.`);
  }
}

function normalizeNotionText(page: NotionPage, source: NotionSourceSelection) {
  return [
    `Title: ${page.title}`,
    `Workspace: ${page.workspace}`,
    page.database ? `Database: ${page.database}` : "",
    `Author: ${page.author}`,
    `Updated: ${page.updatedAt}`,
    `Source: ${source.kind} ${source.id}`,
    ...page.blocks.map((block) => block.unsupported ? `Unsupported block: ${block.id} ${block.type}` : `Block ${block.id} ${block.type}: ${block.text}`),
    ...page.comments.map((comment) => `Comment ${comment.id} by ${comment.author}: ${comment.text}`)
  ].filter(Boolean).join("\n");
}

function notionInput(input: NotionSyncInput, source: NotionSourceSelection, page: NotionPage, cursor?: string): ComposioIngestionInput {
  return {
    connector: "notion",
    sourceType: "docs",
    sourceObjectId: `notion:${input.connectedAccount.id}:${page.id}`,
    sourceUpdatedAt: page.updatedAt,
    principalId: input.principalId,
    connectedAccount: input.connectedAccount,
    provenanceUrl: page.url,
    title: page.title,
    normalizedText: normalizeNotionText(page, source),
    raw: {
      kind: "notion",
      page,
      mode: input.mode,
      source
    },
    acl: {
      teams: source.teams,
      roles: source.roles,
      sensitivity: source.sensitivity
    },
    checkpoint: {
      cursor: cursor ?? page.updatedAt
    }
  };
}

function expectedSignature(secret: string, payload: WebhookPayload) {
  return `sha256=${createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex")}`;
}

function verifySignature(input: WebhookIngestionInput) {
  const expected = expectedSignature(input.secret, input.payload);
  const received = input.signature;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw new Error("Invalid webhook signature.");
  }
}

function validateWebhookPayload(payload: WebhookPayload) {
  if (!payload.sourceId?.trim() || !payload.content?.trim() || !payload.title?.trim() || !payload.provenanceUrl?.trim()) {
    throw new Error("Malformed webhook payload.");
  }
}

function webhookInput(input: WebhookIngestionInput): ComposioIngestionInput {
  return {
    connector: "webhook",
    sourceType: input.payload.sourceType,
    sourceObjectId: `webhook:${input.payload.sourceId}`,
    principalId: input.payload.principalId,
    connectedAccount: {
      id: `webhook:${input.payload.sourceId.split(":")[0]}`,
      status: "active",
      principalId: input.payload.principalId
    },
    provenanceUrl: input.payload.provenanceUrl,
    title: input.payload.title,
    normalizedText: [
      `Title: ${input.payload.title}`,
      `Source: ${input.payload.sourceId}`,
      input.payload.content
    ].join("\n"),
    raw: input.payload.raw,
    acl: input.payload.acl,
    checkpoint: {
      cursor: input.payload.sourceId
    }
  };
}

export function createFlexibleComposioIngestion(options: FlexibleIngestionOptions = {}) {
  const ingestionPipeline = options.ingestionPipeline ?? composioIngestionPipeline;
  const notionClient = options.notionClient ?? createComposioNotionClient();
  const store = options.store ?? createFileStore();
  const now = options.now ?? (() => new Date().toISOString());

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: FlexibleState) {
    await store.write(state);
  }

  return {
    async getState() {
      return load();
    },

    async syncState() {
      const [operator, ingestion] = await Promise.all([load(), ingestionPipeline.getState()]);
      return {
        ...operator,
        artifacts: ingestion.artifacts.filter((artifact) => artifact.connector === "notion" || artifact.connector === "webhook"),
        checkpoints: ingestion.checkpoints.filter((checkpoint) => checkpoint.connector === "notion" || checkpoint.connector === "webhook"),
        runs: ingestion.runs.filter((run) => run.connector === "notion" || run.connector === "webhook")
      };
    },

    async disableSource(sourceId: string) {
      const state = await load();
      if (!state.disabledSources.includes(sourceId)) {
        state.disabledSources.unshift(sourceId);
      }
      await save(state);
      return state;
    },

    async replaySource(sourceId: string) {
      const state = await load();
      state.replays.unshift({ sourceId, replayedAt: now() });
      await save(state);
      return state;
    },

    async syncNotion(input: NotionSyncInput): Promise<NotionSyncResult> {
      assertNotionAllowed(input);
      const state = await load();
      const disabled = input.selectedSources.find((source) => state.disabledSources.includes(`notion:${source.id}`));
      if (disabled) {
        throw new Error(`Notion source ${disabled.id} is disabled.`);
      }

      const statuses: NotionSyncResult["statuses"] = [];
      const artifacts: NormalizedComposioArtifact[] = [];
      const result = await notionClient.fetchNotion(input);
      const selected = new Map(input.selectedSources.map((source) => [source.id, source]));

      for (const page of result.pages) {
        const source = selected.get(page.id) ?? input.selectedSources[0];
        const ingested = await ingestionPipeline.ingestComposioResult(notionInput(input, source, page, result.nextCursor));
        statuses.push(ingested.status);
        artifacts.push(ingested.artifact);
      }

      return { statuses, artifacts };
    },

    async ingestWebhook(input: WebhookIngestionInput) {
      verifySignature(input);
      validateWebhookPayload(input.payload);
      const state = await load();
      if (state.disabledSources.includes(`webhook:${input.payload.sourceId}`)) {
        throw new Error(`Webhook source ${input.payload.sourceId} is disabled.`);
      }
      return ingestionPipeline.ingestComposioResult(webhookInput(input));
    }
  };
}

export const flexibleComposioIngestion = createFlexibleComposioIngestion();
