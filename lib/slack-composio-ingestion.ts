import { composioIngestionPipeline, type ComposioIngestionInput, type NormalizedComposioArtifact } from "./composio-ingestion";
import type { Principal, Sensitivity } from "./types";

type SlackConnectedAccountSnapshot = {
  id: string;
  status: "pending" | "active" | "revoked" | "errored";
  principalId: string;
};

export type SlackChannelSelection = {
  id: string;
  name: string;
  teams: string[];
  roles: Principal["role"][];
  sensitivity: Sensitivity;
};

export type SlackFileSnapshot = {
  id: string;
  name: string;
  url?: string;
};

export type SlackMessageSnapshot = {
  channelId: string;
  channelName?: string;
  ts: string;
  threadTs?: string;
  userId?: string;
  userName?: string;
  text: string;
  permalink?: string;
  replies?: SlackMessageSnapshot[];
  files?: SlackFileSnapshot[];
};

export type SlackHistoryResult = {
  workspaceId: string;
  workspaceName?: string;
  messages: SlackMessageSnapshot[];
  nextCursor?: string;
};

export type SlackSyncInput = {
  principalId: string;
  workspaceId: string;
  workspaceName?: string;
  mode: "backfill" | "incremental";
  connectedAccount: SlackConnectedAccountSnapshot;
  selectedChannels: SlackChannelSelection[];
  allowedChannelIds?: string[];
  sinceTs?: string;
  untilTs?: string;
  cursor?: string;
};

export type SlackSyncResult = {
  mode: SlackSyncInput["mode"];
  workspaceId: string;
  channels: string[];
  nextCursor?: string;
  statuses: Array<"created" | "updated" | "duplicate">;
  artifacts: NormalizedComposioArtifact[];
};

export type SlackComposioClient = {
  fetchChannelHistory(input: SlackSyncInput): Promise<SlackHistoryResult>;
};

type SlackIngestionOptions = {
  ingestionPipeline?: typeof composioIngestionPipeline;
  slackClient?: SlackComposioClient;
};

const defaultRoles: Principal["role"][] = ["admin", "reviewer", "operator", "agent"];

function defaultBaseUrl() {
  return process.env.COMPOSIO_BASE_URL ?? "https://backend.composio.dev";
}

function defaultSlackHistoryTool() {
  return process.env.COMPOSIO_SLACK_HISTORY_TOOL ?? "SLACK_FETCH_CONVERSATION_HISTORY";
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Composio Slack sync failed with ${response.status}: ${text || response.statusText}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function stringValue(input: unknown) {
  return typeof input === "string" ? input : undefined;
}

function arrayValue(input: unknown) {
  return Array.isArray(input) ? input : [];
}

function normalizeMessage(input: Record<string, unknown>, fallbackChannel?: SlackChannelSelection): SlackMessageSnapshot {
  const channelId = stringValue(input.channelId) ?? stringValue(input.channel_id) ?? stringValue(input.channel) ?? fallbackChannel?.id ?? "";
  const channelName = stringValue(input.channelName) ?? stringValue(input.channel_name) ?? fallbackChannel?.name;
  const ts = stringValue(input.ts) ?? stringValue(input.timestamp) ?? stringValue(input.message_ts) ?? "";
  const threadTs = stringValue(input.threadTs) ?? stringValue(input.thread_ts);
  const files = arrayValue(input.files).map((file) => {
    const fileRecord = file as Record<string, unknown>;
    return {
      id: stringValue(fileRecord.id) ?? stringValue(fileRecord.file_id) ?? "file",
      name: stringValue(fileRecord.name) ?? stringValue(fileRecord.title) ?? "Slack file",
      url: stringValue(fileRecord.url) ?? stringValue(fileRecord.url_private) ?? stringValue(fileRecord.permalink)
    };
  });

  return {
    channelId,
    channelName,
    ts,
    threadTs,
    userId: stringValue(input.userId) ?? stringValue(input.user_id) ?? stringValue(input.user),
    userName: stringValue(input.userName) ?? stringValue(input.user_name) ?? stringValue(input.username),
    text: stringValue(input.text) ?? stringValue(input.message) ?? "",
    permalink: stringValue(input.permalink) ?? stringValue(input.url),
    replies: arrayValue(input.replies).map((reply) => normalizeMessage(reply as Record<string, unknown>, fallbackChannel)),
    files
  };
}

function messagesFromPayload(payload: Record<string, unknown>, fallbackChannel?: SlackChannelSelection) {
  const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
  const rawMessages =
    arrayValue(data.messages).length > 0
      ? arrayValue(data.messages)
      : arrayValue(data.items).length > 0
        ? arrayValue(data.items)
        : arrayValue(data.results);

  return rawMessages.map((message) => normalizeMessage(message as Record<string, unknown>, fallbackChannel));
}

function nextCursorFromPayload(payload: Record<string, unknown>) {
  const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
  const responseMetadata = data.response_metadata as Record<string, unknown> | undefined;
  return stringValue(data.nextCursor) ?? stringValue(data.next_cursor) ?? stringValue(responseMetadata?.next_cursor);
}

export function createComposioSlackClient(input: { apiKey?: string; baseUrl?: string; toolSlug?: string } = {}): SlackComposioClient {
  const apiKey = input.apiKey ?? process.env.COMPOSIO_API_KEY;
  const baseUrl = input.baseUrl ?? defaultBaseUrl();
  const toolSlug = input.toolSlug ?? defaultSlackHistoryTool();

  return {
    async fetchChannelHistory(syncInput) {
      if (!apiKey) {
        throw new Error("Composio API key is required for Slack sync.");
      }

      const channel = syncInput.selectedChannels[0];
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
              channel: channel?.id,
              channels: syncInput.selectedChannels.map((candidate) => candidate.id),
              oldest: syncInput.sinceTs,
              latest: syncInput.untilTs,
              cursor: syncInput.cursor,
              include_all_metadata: true,
              inclusive: true,
              limit: 200
            }
          })
        })
      );

      return {
        workspaceId: syncInput.workspaceId,
        workspaceName: syncInput.workspaceName,
        messages: messagesFromPayload(payload, channel),
        nextCursor: nextCursorFromPayload(payload)
      };
    }
  };
}

function slackTsToIso(ts?: string) {
  if (!ts) {
    return undefined;
  }
  const seconds = Number(ts.split(".")[0]);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : undefined;
}

function permalinkFor(message: SlackMessageSnapshot) {
  if (message.permalink) {
    return message.permalink;
  }
  const compactTs = message.ts.replace(".", "").padEnd(16, "0");
  return `https://slack.com/archives/${message.channelId}/p${compactTs}`;
}

function flattenThread(root: SlackMessageSnapshot) {
  return [root, ...(root.replies ?? [])].sort((a, b) => a.ts.localeCompare(b.ts));
}

function threadKey(message: SlackMessageSnapshot) {
  return `${message.channelId}:${message.threadTs ?? message.ts}`;
}

function groupThreads(messages: SlackMessageSnapshot[]) {
  const groups = new Map<string, SlackMessageSnapshot[]>();

  for (const message of messages) {
    const key = threadKey(message);
    groups.set(key, [...(groups.get(key) ?? []), message]);
  }

  return [...groups.values()].map((group) => group.sort((a, b) => a.ts.localeCompare(b.ts))[0]);
}

function normalizeText(input: {
  workspaceName?: string;
  workspaceId: string;
  channel: SlackChannelSelection;
  root: SlackMessageSnapshot;
}) {
  const messages = flattenThread(input.root);
  const lines = [
    `Workspace: ${input.workspaceName ?? input.workspaceId}`,
    `Channel: #${input.channel.name} (${input.channel.id})`,
    `Thread: ${input.root.threadTs ?? input.root.ts}`,
    ...messages.map((message) => {
      const author = message.userName ?? message.userId ?? "unknown";
      return `- ${message.ts} ${author}: ${message.text}`;
    })
  ];
  const files = messages.flatMap((message) => message.files ?? []);
  for (const file of files) {
    lines.push(`File: ${file.name}${file.url ? ` ${file.url}` : ""}`);
  }
  return lines.join("\n");
}

function inputForThread(input: SlackSyncInput, channel: SlackChannelSelection, root: SlackMessageSnapshot, nextCursor?: string): ComposioIngestionInput {
  const threadTs = root.threadTs ?? root.ts;
  const sourceObjectId = `slack:${input.workspaceId}:${channel.id}:${threadTs}`;

  return {
    connector: "slack",
    sourceType: "slack",
    sourceObjectId,
    sourceUpdatedAt: slackTsToIso(root.ts),
    principalId: input.principalId,
    connectedAccount: input.connectedAccount,
    provenanceUrl: permalinkFor(root),
    title: `Slack #${channel.name} thread ${threadTs}`,
    normalizedText: normalizeText({
      workspaceName: input.workspaceName,
      workspaceId: input.workspaceId,
      channel,
      root
    }),
    raw: {
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName,
      channelId: channel.id,
      channelName: channel.name,
      threadTs,
      mode: input.mode,
      messages: flattenThread(root)
    },
    acl: {
      teams: channel.teams,
      roles: channel.roles.length > 0 ? channel.roles : defaultRoles,
      sensitivity: channel.sensitivity
    },
    checkpoint: {
      cursor: nextCursor ?? threadTs
    }
  };
}

function assertSyncAllowed(input: SlackSyncInput) {
  if (input.connectedAccount.status === "revoked") {
    throw new Error(`Slack connected account ${input.connectedAccount.id} is revoked.`);
  }
  if (input.connectedAccount.status !== "active") {
    throw new Error(`Slack connected account ${input.connectedAccount.id} is not active.`);
  }
  if (input.selectedChannels.length === 0) {
    throw new Error("At least one Slack channel must be selected for sync.");
  }

  const allowedChannelIds = input.allowedChannelIds ? new Set(input.allowedChannelIds) : undefined;
  const blocked = allowedChannelIds ? input.selectedChannels.find((channel) => !allowedChannelIds.has(channel.id)) : undefined;
  if (blocked) {
    throw new Error(`Slack channel ${blocked.id} is not allowed for this connected account.`);
  }
}

export function createSlackComposioIngestion(options: SlackIngestionOptions = {}) {
  const ingestionPipeline = options.ingestionPipeline ?? composioIngestionPipeline;
  const slackClient = options.slackClient ?? createComposioSlackClient();

  async function checkpointCursor(input: SlackSyncInput) {
    if (input.mode !== "incremental" || input.cursor) {
      return input.cursor;
    }

    const state = await ingestionPipeline.getState();
    const checkpoint = state.checkpoints.find((candidate) => candidate.id === `slack:${input.connectedAccount.id}`);
    return checkpoint?.cursor;
  }

  return {
    async syncState() {
      const state = await ingestionPipeline.getState();
      return {
        artifacts: state.artifacts.filter((artifact) => artifact.connector === "slack"),
        checkpoints: state.checkpoints.filter((checkpoint) => checkpoint.connector === "slack"),
        runs: state.runs.filter((run) => run.connector === "slack"),
        auditEvents: state.auditEvents.filter((event) => event.metadata.connector === "slack")
      };
    },

    async syncSlack(input: SlackSyncInput): Promise<SlackSyncResult> {
      assertSyncAllowed(input);
      const cursor = await checkpointCursor(input);
      const history = await slackClient.fetchChannelHistory({ ...input, cursor });
      const selectedById = new Map(input.selectedChannels.map((channel) => [channel.id, channel]));
      const roots = groupThreads(history.messages).filter((message) => selectedById.has(message.channelId));
      const statuses: SlackSyncResult["statuses"] = [];
      const artifacts: NormalizedComposioArtifact[] = [];

      for (const root of roots) {
        const channel = selectedById.get(root.channelId);
        if (!channel) {
          continue;
        }
        const result = await ingestionPipeline.ingestComposioResult(inputForThread(input, channel, root, history.nextCursor));
        statuses.push(result.status);
        artifacts.push(result.artifact);
      }

      return {
        mode: input.mode,
        workspaceId: history.workspaceId,
        channels: input.selectedChannels.map((channel) => channel.id),
        nextCursor: history.nextCursor,
        statuses,
        artifacts
      };
    }
  };
}

export const slackComposioIngestion = createSlackComposioIngestion();
