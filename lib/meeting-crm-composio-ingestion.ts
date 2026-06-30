import { composioIngestionPipeline, type ComposioIngestionInput, type NormalizedComposioArtifact } from "./composio-ingestion";
import type { Principal, Sensitivity } from "./types";

type ConnectedAccountSnapshot = {
  id: string;
  status: "pending" | "active" | "revoked" | "errored";
  principalId: string;
};

export type MeetingCrmSourceKind = "zoom" | "google-meet" | "salesforce" | "hubspot";
export type CoverageCapability = "acl" | "delta" | "webhook";

export type MeetingCrmSourceSelection = {
  kind: MeetingCrmSourceKind;
  scope: string;
  name: string;
  teams: string[];
  roles: Principal["role"][];
  sensitivity: Sensitivity;
  coverage?: Partial<Record<CoverageCapability, boolean>>;
  nativeFallbackApproved?: boolean;
};

export type MeetingParticipant = {
  name: string;
  email?: string;
  role?: string;
};

export type TranscriptSegment = {
  speaker: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type MeetingTranscriptItem = {
  id: string;
  title: string;
  url: string;
  provider: "zoom" | "google-meet";
  participants: MeetingParticipant[];
  startedAt: string;
  endedAt: string;
  transcript: TranscriptSegment[];
  recording?: {
    id: string;
    url: string;
    durationSeconds: number;
    fileType: string;
  };
  sensitivity?: Sensitivity;
};

export type CrmRecordItem = {
  id: string;
  type: "account" | "deal" | "note";
  title: string;
  url: string;
  account?: {
    id: string;
    name: string;
    domain?: string;
  };
  deal?: {
    id: string;
    name: string;
    stage: string;
    amount?: number;
  };
  owner: {
    id: string;
    name: string;
    email?: string;
  };
  updatedAt: string;
  body: string;
  permissions: Record<string, unknown>;
};

export type MeetingCrmPage<T> = {
  items: T[];
  nextCursor?: string;
};

export type MeetingCrmSyncInput = {
  principalId: string;
  mode: "backfill" | "incremental";
  connectedAccount: ConnectedAccountSnapshot;
  selectedSources: MeetingCrmSourceSelection[];
  allowedScopes?: string[];
  cursor?: string;
};

export type MeetingCrmFallbackRequirement = {
  sourceKind: MeetingCrmSourceKind;
  scope: string;
  requiredAdapter: "native";
  status: "blocked" | "approved";
  missingCapabilities: CoverageCapability[];
  reason: string;
};

export type MeetingCrmSyncResult = {
  mode: MeetingCrmSyncInput["mode"];
  sources: MeetingCrmSourceKind[];
  statuses: Array<"created" | "updated" | "duplicate">;
  artifacts: NormalizedComposioArtifact[];
  fallbackRequirements: MeetingCrmFallbackRequirement[];
};

export type MeetingCrmComposioClient = {
  fetchMeetings(input: MeetingCrmSyncInput): Promise<MeetingCrmPage<MeetingTranscriptItem>>;
  fetchSalesforce(input: MeetingCrmSyncInput): Promise<MeetingCrmPage<CrmRecordItem>>;
  fetchHubSpot(input: MeetingCrmSyncInput): Promise<MeetingCrmPage<CrmRecordItem>>;
};

type Options = {
  ingestionPipeline?: typeof composioIngestionPipeline;
  meetingCrmClient?: MeetingCrmComposioClient;
};

const connectors = new Set(["zoom", "google-meet", "salesforce", "hubspot"]);
const requiredCoverage: CoverageCapability[] = ["acl", "delta", "webhook"];

function defaultBaseUrl() {
  return process.env.COMPOSIO_BASE_URL ?? "https://backend.composio.dev";
}

function toolSlug(kind: MeetingCrmSourceKind) {
  const envKey = `COMPOSIO_${kind.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_SYNC_TOOL`;
  return process.env[envKey] ?? `${kind.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_SYNC`;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Composio meeting/CRM sync failed with ${response.status}: ${text || response.statusText}`);
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

function meetingItemsFromPayload(payload: Record<string, unknown>, provider: "zoom" | "google-meet"): MeetingTranscriptItem[] {
  return itemsPayload(payload).map((item) => {
    const record = recordValue(item);
    return {
      id: stringValue(record.id) ?? "",
      title: stringValue(record.title) ?? stringValue(record.topic) ?? "Meeting transcript",
      url: stringValue(record.url) ?? stringValue(record.recording_url) ?? "",
      provider,
      participants: arrayValue(record.participants).map((participant) => {
        const participantRecord = recordValue(participant);
        return {
          name: stringValue(participantRecord.name) ?? "Unknown",
          email: stringValue(participantRecord.email),
          role: stringValue(participantRecord.role)
        };
      }),
      startedAt: stringValue(record.startedAt) ?? stringValue(record.started_at) ?? new Date().toISOString(),
      endedAt: stringValue(record.endedAt) ?? stringValue(record.ended_at) ?? new Date().toISOString(),
      transcript: arrayValue(record.transcript).map((segment) => {
        const segmentRecord = recordValue(segment);
        return {
          speaker: stringValue(segmentRecord.speaker) ?? "Unknown",
          startSeconds: numberValue(segmentRecord.startSeconds) ?? numberValue(segmentRecord.start_seconds) ?? 0,
          endSeconds: numberValue(segmentRecord.endSeconds) ?? numberValue(segmentRecord.end_seconds) ?? 0,
          text: stringValue(segmentRecord.text) ?? ""
        };
      }),
      recording: record.recording
        ? {
            id: stringValue(recordValue(record.recording).id) ?? "",
            url: stringValue(recordValue(record.recording).url) ?? "",
            durationSeconds: numberValue(recordValue(record.recording).durationSeconds) ?? numberValue(recordValue(record.recording).duration_seconds) ?? 0,
            fileType: stringValue(recordValue(record.recording).fileType) ?? stringValue(recordValue(record.recording).file_type) ?? "unknown"
          }
        : undefined,
      sensitivity: stringValue(record.sensitivity) as Sensitivity | undefined
    };
  });
}

function crmItemsFromPayload(payload: Record<string, unknown>): CrmRecordItem[] {
  return itemsPayload(payload).map((item) => {
    const record = recordValue(item);
    const owner = recordValue(record.owner);
    const account = record.account ? recordValue(record.account) : undefined;
    const deal = record.deal ? recordValue(record.deal) : undefined;
    return {
      id: stringValue(record.id) ?? "",
      type: (stringValue(record.type) as CrmRecordItem["type"] | undefined) ?? "deal",
      title: stringValue(record.title) ?? stringValue(record.name) ?? "CRM record",
      url: stringValue(record.url) ?? "",
      account: account
        ? {
            id: stringValue(account.id) ?? "",
            name: stringValue(account.name) ?? "",
            domain: stringValue(account.domain)
          }
        : undefined,
      deal: deal
        ? {
            id: stringValue(deal.id) ?? "",
            name: stringValue(deal.name) ?? "",
            stage: stringValue(deal.stage) ?? "",
            amount: numberValue(deal.amount)
          }
        : undefined,
      owner: {
        id: stringValue(owner.id) ?? "",
        name: stringValue(owner.name) ?? "Unknown",
        email: stringValue(owner.email)
      },
      updatedAt: stringValue(record.updatedAt) ?? stringValue(record.updated_at) ?? new Date().toISOString(),
      body: stringValue(record.body) ?? stringValue(record.notes) ?? stringValue(record.description) ?? "",
      permissions: recordValue(record.permissions)
    };
  });
}

export function createComposioMeetingCrmClient(input: { apiKey?: string; baseUrl?: string } = {}): MeetingCrmComposioClient {
  const apiKey = input.apiKey ?? process.env.COMPOSIO_API_KEY;
  const baseUrl = input.baseUrl ?? defaultBaseUrl();

  async function execute(kind: MeetingCrmSourceKind, syncInput: MeetingCrmSyncInput) {
    if (!apiKey) {
      throw new Error("Composio API key is required for meeting/CRM sync.");
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
            include_acl: true,
            include_transcript: true,
            include_recording: true,
            include_permissions: true,
            limit: 100
          }
        })
      })
    );
  }

  return {
    async fetchMeetings(syncInput) {
      const kind = syncInput.selectedSources[0].kind;
      const payload = await execute(kind, syncInput);
      return {
        items: meetingItemsFromPayload(payload, kind === "google-meet" ? "google-meet" : "zoom"),
        nextCursor: nextCursorFromPayload(payload)
      };
    },
    async fetchSalesforce(syncInput) {
      const payload = await execute("salesforce", syncInput);
      return { items: crmItemsFromPayload(payload), nextCursor: nextCursorFromPayload(payload) };
    },
    async fetchHubSpot(syncInput) {
      const payload = await execute("hubspot", syncInput);
      return { items: crmItemsFromPayload(payload), nextCursor: nextCursorFromPayload(payload) };
    }
  };
}

function isMeeting(kind: MeetingCrmSourceKind) {
  return kind === "zoom" || kind === "google-meet";
}

function metadataLines(prefix: string, metadata: Record<string, unknown>) {
  return Object.entries(metadata).map(([key, value]) => `${prefix} ${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
}

function normalizeMeeting(item: MeetingTranscriptItem, source: MeetingCrmSourceSelection) {
  return [
    `Title: ${item.title}`,
    `Provider: ${item.provider}`,
    `Provenance: ${item.url}`,
    `Sensitivity: ${item.sensitivity ?? source.sensitivity}`,
    `Time range: ${item.startedAt} - ${item.endedAt}`,
    ...item.participants.map((participant) => `Participant: ${participant.name} <${participant.email ?? "unknown"}> ${participant.role ?? "attendee"}`),
    item.recording ? `Recording: ${item.recording.id} ${item.recording.fileType} ${item.recording.durationSeconds}s ${item.recording.url}` : "",
    ...item.transcript.map((segment) => `${segment.startSeconds}-${segment.endSeconds} ${segment.speaker}: ${segment.text}`)
  ].filter(Boolean).join("\n");
}

function normalizeCrm(item: CrmRecordItem, source: MeetingCrmSourceSelection) {
  return [
    `Title: ${item.title}`,
    `Type: ${item.type}`,
    item.account ? `Account: ${item.account.name} <${item.account.domain ?? item.account.id}>` : "",
    item.deal ? `Deal: ${item.deal.name} ${item.deal.stage} ${item.deal.amount ?? ""}`.trim() : "",
    `Owner: ${item.owner.name} <${item.owner.email ?? item.owner.id}>`,
    `Updated: ${item.updatedAt}`,
    `Sensitivity: ${source.sensitivity}`,
    ...metadataLines("Permission", item.permissions),
    `Body: ${item.body}`
  ].filter(Boolean).join("\n");
}

function meetingInput(input: MeetingCrmSyncInput, source: MeetingCrmSourceSelection, item: MeetingTranscriptItem, cursor?: string): ComposioIngestionInput {
  return {
    connector: source.kind,
    sourceType: "meeting",
    sourceObjectId: `${source.kind}:${input.connectedAccount.id}:${item.id}`,
    sourceUpdatedAt: item.endedAt,
    principalId: input.principalId,
    connectedAccount: input.connectedAccount,
    provenanceUrl: item.url,
    title: item.title,
    normalizedText: normalizeMeeting(item, source),
    raw: { kind: source.kind, item, mode: input.mode, source },
    acl: {
      teams: source.teams,
      roles: source.roles,
      sensitivity: item.sensitivity ?? source.sensitivity
    },
    checkpoint: {
      cursor: cursor ?? item.endedAt
    }
  };
}

function crmInput(input: MeetingCrmSyncInput, source: MeetingCrmSourceSelection, item: CrmRecordItem, cursor?: string): ComposioIngestionInput {
  return {
    connector: source.kind,
    sourceType: "crm",
    sourceObjectId: `${source.kind}:${input.connectedAccount.id}:${item.id}`,
    sourceUpdatedAt: item.updatedAt,
    principalId: input.principalId,
    connectedAccount: input.connectedAccount,
    provenanceUrl: item.url,
    title: item.title,
    normalizedText: normalizeCrm(item, source),
    raw: { kind: source.kind, item, mode: input.mode, source },
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

function fallbackRequirementsFor(input: MeetingCrmSyncInput): MeetingCrmFallbackRequirement[] {
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

function assertSyncAllowed(input: MeetingCrmSyncInput) {
  if (input.connectedAccount.status === "revoked") {
    throw new Error(`Meeting/CRM connected account ${input.connectedAccount.id} is revoked.`);
  }
  if (input.connectedAccount.status !== "active") {
    throw new Error(`Meeting/CRM connected account ${input.connectedAccount.id} is not active.`);
  }
  if (input.selectedSources.length === 0) {
    throw new Error("At least one meeting or CRM source must be selected.");
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

export function createMeetingCrmComposioIngestion(options: Options = {}) {
  const ingestionPipeline = options.ingestionPipeline ?? composioIngestionPipeline;
  const meetingCrmClient = options.meetingCrmClient ?? createComposioMeetingCrmClient();

  async function checkpointCursor(connector: string, input: MeetingCrmSyncInput) {
    if (input.mode !== "incremental" || input.cursor) {
      return input.cursor;
    }
    const state = await ingestionPipeline.getState();
    const checkpoint = state.checkpoints.find((candidate) => candidate.id === `${connector}:${input.connectedAccount.id}`);
    return checkpoint?.cursor;
  }

  async function ingestPage(input: MeetingCrmSyncInput, source: MeetingCrmSourceSelection, cursor: string | undefined) {
    const statuses: MeetingCrmSyncResult["statuses"] = [];
    const artifacts: NormalizedComposioArtifact[] = [];

    if (isMeeting(source.kind)) {
      const page = await meetingCrmClient.fetchMeetings({ ...input, selectedSources: [source], cursor });
      for (const item of page.items) {
        const ingested = await ingestionPipeline.ingestComposioResult(meetingInput(input, source, item, page.nextCursor));
        statuses.push(ingested.status);
        artifacts.push(ingested.artifact);
      }
      return { statuses, artifacts, nextCursor: page.nextCursor };
    }

    if (source.kind === "salesforce") {
      const page = await meetingCrmClient.fetchSalesforce({ ...input, selectedSources: [source], cursor });
      for (const item of page.items) {
        const ingested = await ingestionPipeline.ingestComposioResult(crmInput(input, source, item, page.nextCursor));
        statuses.push(ingested.status);
        artifacts.push(ingested.artifact);
      }
      return { statuses, artifacts, nextCursor: page.nextCursor };
    }

    const page = await meetingCrmClient.fetchHubSpot({ ...input, selectedSources: [source], cursor });
    for (const item of page.items) {
      const ingested = await ingestionPipeline.ingestComposioResult(crmInput(input, source, item, page.nextCursor));
      statuses.push(ingested.status);
      artifacts.push(ingested.artifact);
    }
    return { statuses, artifacts, nextCursor: page.nextCursor };
  }

  return {
    fallbackRequirements(input: MeetingCrmSyncInput) {
      return fallbackRequirementsFor(input);
    },

    async syncState() {
      const state = await ingestionPipeline.getState();
      return {
        artifacts: state.artifacts.filter((artifact) => connectors.has(artifact.connector)),
        checkpoints: state.checkpoints.filter((checkpoint) => connectors.has(checkpoint.connector)),
        runs: state.runs.filter((run) => connectors.has(run.connector)),
        auditEvents: state.auditEvents.filter((event) => connectors.has(String(event.metadata.connector)))
      };
    },

    async syncMeetingCrm(input: MeetingCrmSyncInput): Promise<MeetingCrmSyncResult> {
      assertSyncAllowed(input);
      const fallbackRequirements = fallbackRequirementsFor(input);
      const statuses: MeetingCrmSyncResult["statuses"] = [];
      const artifacts: NormalizedComposioArtifact[] = [];

      for (const source of input.selectedSources) {
        let cursor = await checkpointCursor(source.kind, input);
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

export const meetingCrmComposioIngestion = createMeetingCrmComposioIngestion();
