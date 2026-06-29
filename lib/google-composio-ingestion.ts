import { composioIngestionPipeline, type ComposioIngestionInput, type NormalizedComposioArtifact } from "./composio-ingestion";
import type { Principal, Sensitivity } from "./types";

type GoogleConnectedAccountSnapshot = {
  id: string;
  status: "pending" | "active" | "revoked" | "errored";
  principalId: string;
};

export type GoogleSourceSelection = {
  kind: "drive" | "gmail";
  scope: string;
  name: string;
  teams: string[];
  roles: Principal["role"][];
  sensitivity: Sensitivity;
  folderIds?: string[];
  labelIds?: string[];
};

export type GoogleDriveDocument = {
  id: string;
  title: string;
  mimeType: string;
  url: string;
  modifiedAt: string;
  authors: string[];
  owners: string[];
  text: string;
  folders?: string[];
};

export type GmailAttachment = {
  id: string;
  name: string;
  mimeType: string;
  supported: boolean;
  url?: string;
};

export type GmailThreadMessage = {
  id: string;
  from: string;
  to: string[];
  sentAt: string;
  body: string;
  attachments: GmailAttachment[];
};

export type GmailThread = {
  id: string;
  subject: string;
  url: string;
  labels: string[];
  modifiedAt: string;
  messages: GmailThreadMessage[];
};

export type GoogleDriveResult = {
  documents: GoogleDriveDocument[];
  nextCursor?: string;
};

export type GmailResult = {
  threads: GmailThread[];
  nextCursor?: string;
};

export type GoogleSyncInput = {
  principalId: string;
  mode: "backfill" | "incremental";
  connectedAccount: GoogleConnectedAccountSnapshot;
  selectedSources: GoogleSourceSelection[];
  allowedScopes?: string[];
  cursor?: string;
};

export type GoogleSyncResult = {
  mode: GoogleSyncInput["mode"];
  sources: Array<GoogleSourceSelection["kind"]>;
  statuses: Array<"created" | "updated" | "duplicate">;
  artifacts: NormalizedComposioArtifact[];
};

export type GoogleComposioClient = {
  fetchDrive(input: GoogleSyncInput): Promise<GoogleDriveResult>;
  fetchGmail(input: GoogleSyncInput): Promise<GmailResult>;
};

type GoogleIngestionOptions = {
  ingestionPipeline?: typeof composioIngestionPipeline;
  googleClient?: GoogleComposioClient;
};

const maxNormalizedBodyLength = 7200;

function defaultBaseUrl() {
  return process.env.COMPOSIO_BASE_URL ?? "https://backend.composio.dev";
}

function driveToolSlug() {
  return process.env.COMPOSIO_GOOGLE_DRIVE_SYNC_TOOL ?? "GOOGLEDRIVE_SEARCH_FILES";
}

function gmailToolSlug() {
  return process.env.COMPOSIO_GMAIL_SYNC_TOOL ?? "GMAIL_FETCH_EMAILS";
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Composio Google sync failed with ${response.status}: ${text || response.statusText}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function stringValue(input: unknown) {
  return typeof input === "string" ? input : undefined;
}

function boolValue(input: unknown) {
  return typeof input === "boolean" ? input : undefined;
}

function arrayValue(input: unknown) {
  return Array.isArray(input) ? input : [];
}

function recordValue(input: unknown) {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function dataPayload(payload: Record<string, unknown>) {
  return recordValue(payload.data ?? payload);
}

function nextCursorFromPayload(payload: Record<string, unknown>) {
  const data = dataPayload(payload);
  return stringValue(data.nextCursor) ?? stringValue(data.next_cursor) ?? stringValue(recordValue(data.response_metadata).next_cursor);
}

function driveDocumentsFromPayload(payload: Record<string, unknown>) {
  const data = dataPayload(payload);
  const rawDocuments = arrayValue(data.documents).length > 0
    ? arrayValue(data.documents)
    : arrayValue(data.files).length > 0
      ? arrayValue(data.files)
      : arrayValue(data.items);

  return rawDocuments.map((item) => {
    const record = recordValue(item);
    return {
      id: stringValue(record.id) ?? stringValue(record.file_id) ?? "",
      title: stringValue(record.title) ?? stringValue(record.name) ?? "Google Drive document",
      mimeType: stringValue(record.mimeType) ?? stringValue(record.mime_type) ?? "application/octet-stream",
      url: stringValue(record.url) ?? stringValue(record.webViewLink) ?? stringValue(record.web_view_link) ?? "",
      modifiedAt: stringValue(record.modifiedAt) ?? stringValue(record.modified_time) ?? stringValue(record.modifiedTime) ?? new Date().toISOString(),
      authors: arrayValue(record.authors).map(String),
      owners: arrayValue(record.owners).map(String),
      text: stringValue(record.text) ?? stringValue(record.body) ?? "",
      folders: arrayValue(record.folders).map(String)
    };
  });
}

function gmailThreadsFromPayload(payload: Record<string, unknown>) {
  const data = dataPayload(payload);
  const rawThreads = arrayValue(data.threads).length > 0 ? arrayValue(data.threads) : arrayValue(data.items);

  return rawThreads.map((item) => {
    const record = recordValue(item);
    const messages = arrayValue(record.messages).map((message) => {
      const messageRecord = recordValue(message);
      return {
        id: stringValue(messageRecord.id) ?? "",
        from: stringValue(messageRecord.from) ?? "",
        to: arrayValue(messageRecord.to).map(String),
        sentAt: stringValue(messageRecord.sentAt) ?? stringValue(messageRecord.sent_at) ?? stringValue(messageRecord.date) ?? "",
        body: stringValue(messageRecord.body) ?? stringValue(messageRecord.text) ?? "",
        attachments: arrayValue(messageRecord.attachments).map((attachment) => {
          const attachmentRecord = recordValue(attachment);
          return {
            id: stringValue(attachmentRecord.id) ?? "",
            name: stringValue(attachmentRecord.name) ?? stringValue(attachmentRecord.filename) ?? "Attachment",
            mimeType: stringValue(attachmentRecord.mimeType) ?? stringValue(attachmentRecord.mime_type) ?? "application/octet-stream",
            supported: boolValue(attachmentRecord.supported) ?? true,
            url: stringValue(attachmentRecord.url)
          };
        })
      };
    });

    return {
      id: stringValue(record.id) ?? stringValue(record.thread_id) ?? "",
      subject: stringValue(record.subject) ?? "Gmail thread",
      url: stringValue(record.url) ?? stringValue(record.permalink) ?? "",
      labels: arrayValue(record.labels).map(String),
      modifiedAt: stringValue(record.modifiedAt) ?? stringValue(record.modified_at) ?? messages.at(-1)?.sentAt ?? new Date().toISOString(),
      messages
    };
  });
}

export function createComposioGoogleClient(input: { apiKey?: string; baseUrl?: string; driveTool?: string; gmailTool?: string } = {}): GoogleComposioClient {
  const apiKey = input.apiKey ?? process.env.COMPOSIO_API_KEY;
  const baseUrl = input.baseUrl ?? defaultBaseUrl();

  async function execute(toolSlug: string, syncInput: GoogleSyncInput, args: Record<string, unknown>) {
    if (!apiKey) {
      throw new Error("Composio API key is required for Google sync.");
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
    async fetchDrive(syncInput) {
      const source = syncInput.selectedSources.find((candidate) => candidate.kind === "drive");
      const payload = await execute(input.driveTool ?? driveToolSlug(), syncInput, {
        cursor: syncInput.cursor,
        folder_ids: source?.folderIds,
        include_permissions: true,
        include_content: true,
        limit: 100
      });
      return {
        documents: driveDocumentsFromPayload(payload),
        nextCursor: nextCursorFromPayload(payload)
      };
    },
    async fetchGmail(syncInput) {
      const source = syncInput.selectedSources.find((candidate) => candidate.kind === "gmail");
      const payload = await execute(input.gmailTool ?? gmailToolSlug(), syncInput, {
        cursor: syncInput.cursor,
        label_ids: source?.labelIds,
        include_attachments: true,
        limit: 100
      });
      return {
        threads: gmailThreadsFromPayload(payload),
        nextCursor: nextCursorFromPayload(payload)
      };
    }
  };
}

function assertSyncAllowed(input: GoogleSyncInput) {
  if (input.connectedAccount.status === "revoked") {
    throw new Error(`Google connected account ${input.connectedAccount.id} is revoked.`);
  }
  if (input.connectedAccount.status !== "active") {
    throw new Error(`Google connected account ${input.connectedAccount.id} is not active.`);
  }
  if (input.selectedSources.length === 0) {
    throw new Error("At least one Google source must be selected for sync.");
  }

  const allowedScopes = input.allowedScopes ? new Set(input.allowedScopes) : undefined;
  const blocked = allowedScopes ? input.selectedSources.find((source) => !allowedScopes.has(source.scope)) : undefined;
  if (blocked) {
    throw new Error(`Google scope ${blocked.scope} is not available for this connected account.`);
  }
}

function boundedText(input: string) {
  if (input.length <= maxNormalizedBodyLength) {
    return input;
  }
  return `${input.slice(0, maxNormalizedBodyLength)}\n[truncated ${input.length - maxNormalizedBodyLength} characters]`;
}

function normalizeDriveText(document: GoogleDriveDocument, source: GoogleSourceSelection) {
  return [
    `Title: ${document.title}`,
    `MIME: ${document.mimeType}`,
    `Modified: ${document.modifiedAt}`,
    ...document.authors.map((author) => `Author: ${author}`),
    ...document.owners.map((owner) => `Owner: ${owner}`),
    `Scope: ${source.scope}`,
    document.folders?.length ? `Folders: ${document.folders.join(", ")}` : "",
    "Content:",
    boundedText(document.text)
  ].filter(Boolean).join("\n");
}

function normalizeGmailText(thread: GmailThread, source: GoogleSourceSelection) {
  const lines = [
    `Subject: ${thread.subject}`,
    `Labels: ${thread.labels.join(", ")}`,
    `Scope: ${source.scope}`,
    ...thread.messages.map((message) => `${message.sentAt} ${message.from} -> ${message.to.join(", ")}: ${message.body}`)
  ];

  for (const message of thread.messages) {
    for (const attachment of message.attachments) {
      lines.push(
        attachment.supported
          ? `Attachment: ${attachment.name} ${attachment.mimeType}`
          : `Unsupported attachment: ${attachment.name} ${attachment.mimeType}`
      );
    }
  }

  return lines.join("\n");
}

function driveInput(input: GoogleSyncInput, source: GoogleSourceSelection, document: GoogleDriveDocument, cursor?: string): ComposioIngestionInput {
  return {
    connector: "google-drive",
    sourceType: "docs",
    sourceObjectId: `google-drive:${input.connectedAccount.id}:${document.id}`,
    sourceUpdatedAt: document.modifiedAt,
    principalId: input.principalId,
    connectedAccount: input.connectedAccount,
    provenanceUrl: document.url,
    title: document.title,
    normalizedText: normalizeDriveText(document, source),
    raw: {
      kind: "drive",
      document,
      mode: input.mode,
      source
    },
    acl: {
      teams: source.teams,
      roles: source.roles,
      sensitivity: source.sensitivity
    },
    checkpoint: {
      cursor: cursor ?? document.modifiedAt
    }
  };
}

function gmailInput(input: GoogleSyncInput, source: GoogleSourceSelection, thread: GmailThread, cursor?: string): ComposioIngestionInput {
  return {
    connector: "gmail",
    sourceType: "email",
    sourceObjectId: `gmail:${input.connectedAccount.id}:${thread.id}`,
    sourceUpdatedAt: thread.modifiedAt,
    principalId: input.principalId,
    connectedAccount: input.connectedAccount,
    provenanceUrl: thread.url,
    title: thread.subject,
    normalizedText: normalizeGmailText(thread, source),
    raw: {
      kind: "gmail",
      thread,
      mode: input.mode,
      source
    },
    acl: {
      teams: source.teams,
      roles: source.roles,
      sensitivity: source.sensitivity
    },
    checkpoint: {
      cursor: cursor ?? thread.modifiedAt
    }
  };
}

export function createGoogleComposioIngestion(options: GoogleIngestionOptions = {}) {
  const ingestionPipeline = options.ingestionPipeline ?? composioIngestionPipeline;
  const googleClient = options.googleClient ?? createComposioGoogleClient();

  async function checkpointCursor(connector: "google-drive" | "gmail", input: GoogleSyncInput) {
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
        artifacts: state.artifacts.filter((artifact) => artifact.connector === "google-drive" || artifact.connector === "gmail"),
        checkpoints: state.checkpoints.filter((checkpoint) => checkpoint.connector === "google-drive" || checkpoint.connector === "gmail"),
        runs: state.runs.filter((run) => run.connector === "google-drive" || run.connector === "gmail"),
        auditEvents: state.auditEvents.filter((event) => event.metadata.connector === "google-drive" || event.metadata.connector === "gmail")
      };
    },

    async syncGoogle(input: GoogleSyncInput): Promise<GoogleSyncResult> {
      assertSyncAllowed(input);
      const statuses: GoogleSyncResult["statuses"] = [];
      const artifacts: NormalizedComposioArtifact[] = [];

      for (const source of input.selectedSources) {
        if (source.kind === "drive") {
          const cursor = await checkpointCursor("google-drive", input);
          const result = await googleClient.fetchDrive({ ...input, selectedSources: [source], cursor });
          for (const document of result.documents) {
            const ingested = await ingestionPipeline.ingestComposioResult(driveInput(input, source, document, result.nextCursor));
            statuses.push(ingested.status);
            artifacts.push(ingested.artifact);
          }
        }

        if (source.kind === "gmail") {
          const cursor = await checkpointCursor("gmail", input);
          const result = await googleClient.fetchGmail({ ...input, selectedSources: [source], cursor });
          for (const thread of result.threads) {
            const ingested = await ingestionPipeline.ingestComposioResult(gmailInput(input, source, thread, result.nextCursor));
            statuses.push(ingested.status);
            artifacts.push(ingested.artifact);
          }
        }
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

export const googleComposioIngestion = createGoogleComposioIngestion();
