import { describe, expect, it } from "vitest";
import { POST as commitBrain } from "../app/api/v1/brain/commit/route";
import { POST as queryBrain } from "../app/api/v1/brain/query/route";
import { POST as mergeChangeset } from "../app/api/v1/changesets/[id]/merge/route";
import { PATCH as reviewChangeset } from "../app/api/v1/changesets/[id]/review/route";
import { createComposioIngestionPipeline, type ComposioIngestionState, type ComposioIngestionStore } from "../lib/composio-ingestion";
import {
  createGoogleComposioIngestion,
  type GoogleComposioClient,
  type GoogleSyncInput
} from "../lib/google-composio-ingestion";

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

function baseSyncInput(overrides: Partial<GoogleSyncInput> = {}): GoogleSyncInput {
  return {
    principalId: "usr_admin",
    mode: "backfill",
    connectedAccount: {
      id: "acct_google",
      status: "active",
      principalId: "usr_admin"
    },
    selectedSources: [
      {
        kind: "drive",
        scope: "drive.readonly",
        name: "Shared Drive",
        teams: ["platform"],
        roles: ["admin", "reviewer", "operator", "agent"],
        sensitivity: "internal"
      }
    ],
    allowedScopes: ["drive.readonly", "gmail.readonly"],
    ...overrides
  };
}

function largeDriveDoc(content = "AI-native launch decision. ") {
  return {
    documents: [
      {
        id: "doc_123",
        title: "AI-native launch plan",
        mimeType: "application/vnd.google-apps.document",
        url: "https://docs.google.com/document/d/doc_123",
        modifiedAt: "2026-06-29T10:00:00.000Z",
        authors: ["anika@example.com"],
        owners: ["ops@example.com"],
        text: content.repeat(700),
        folders: ["Product"]
      }
    ],
    nextCursor: "drive_cursor_1"
  };
}

function gmailThread(subject = "Rollout decision") {
  return {
    threads: [
      {
        id: "thread_123",
        subject,
        url: "https://mail.google.com/mail/u/0/#inbox/thread_123",
        labels: ["INBOX", "IMPORTANT"],
        modifiedAt: "2026-06-29T11:00:00.000Z",
        messages: [
          {
            id: "msg_1",
            from: "anika@example.com",
            to: ["ops@example.com"],
            sentAt: "2026-06-29T10:30:00.000Z",
            body: "Please approve the agent rollout package.",
            attachments: [
              {
                id: "att_1",
                name: "rollout.zip",
                mimeType: "application/zip",
                supported: false
              }
            ]
          },
          {
            id: "msg_2",
            from: "ops@example.com",
            to: ["anika@example.com"],
            sentAt: "2026-06-29T10:42:00.000Z",
            body: "Approved after security review.",
            attachments: []
          }
        ]
      }
    ],
    nextCursor: "gmail_cursor_1"
  };
}

function createFakeGoogleClient(input: {
  drive?: ReturnType<typeof largeDriveDoc>[];
  gmail?: ReturnType<typeof gmailThread>[];
}): GoogleComposioClient & { driveCalls: GoogleSyncInput[]; gmailCalls: GoogleSyncInput[] } {
  return {
    driveCalls: [],
    gmailCalls: [],
    async fetchDrive(inputPayload) {
      this.driveCalls.push(inputPayload);
      const index = Math.min(this.driveCalls.length - 1, (input.drive?.length ?? 1) - 1);
      return input.drive?.[index] ?? { documents: [], nextCursor: undefined };
    },
    async fetchGmail(inputPayload) {
      this.gmailCalls.push(inputPayload);
      const index = Math.min(this.gmailCalls.length - 1, (input.gmail?.length ?? 1) - 1);
      return input.gmail?.[index] ?? { threads: [], nextCursor: undefined };
    }
  };
}

describe("Google Composio ingestion", () => {
  it("backfills large Drive docs into bounded source artifacts with provenance and ACL metadata", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const googleClient = createFakeGoogleClient({ drive: [largeDriveDoc()] });
    const worker = createGoogleComposioIngestion({ ingestionPipeline: pipeline, googleClient });

    const result = await worker.syncGoogle(baseSyncInput());

    expect(result.statuses).toEqual(["created"]);
    expect(result.artifacts[0]).toMatchObject({
      connector: "google-drive",
      sourceObjectId: "google-drive:acct_google:doc_123",
      provenanceUrl: "https://docs.google.com/document/d/doc_123",
      acl: {
        sensitivity: "internal",
        teams: ["platform"]
      },
      source: {
        sourceType: "docs",
        title: "AI-native launch plan",
        capturedAt: "2026-06-29T10:00:00.000Z"
      }
    });
    expect(result.artifacts[0].normalizedText).toContain("Author: anika@example.com");
    expect(result.artifacts[0].normalizedText.length).toBeLessThan(9000);
    expect(result.artifacts[0].normalizedText).toContain("truncated");
    expect(store.snapshot()?.checkpoints[0]).toMatchObject({
      connector: "google-drive",
      connectedAccountId: "acct_google",
      cursor: "drive_cursor_1"
    });
  });

  it("backfills Gmail threads with labels, message structure, and unsupported attachment metadata", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const googleClient = createFakeGoogleClient({ gmail: [gmailThread()] });
    const worker = createGoogleComposioIngestion({ ingestionPipeline: pipeline, googleClient });

    const result = await worker.syncGoogle(
      baseSyncInput({
        selectedSources: [
          {
            kind: "gmail",
            scope: "gmail.readonly",
            name: "Inbox",
            teams: ["revenue"],
            roles: ["admin", "reviewer", "operator", "agent"],
            sensitivity: "confidential"
          }
        ]
      })
    );

    expect(result.artifacts[0]).toMatchObject({
      connector: "gmail",
      sourceObjectId: "gmail:acct_google:thread_123",
      source: {
        sourceType: "email",
        title: "Rollout decision"
      },
      acl: {
        sensitivity: "confidential",
        teams: ["revenue"]
      }
    });
    expect(result.artifacts[0].normalizedText).toContain("Labels: INBOX, IMPORTANT");
    expect(result.artifacts[0].normalizedText).toContain("Unsupported attachment: rollout.zip application/zip");
  });

  it("uses the prior Drive checkpoint for incremental sync and updates changed docs", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const googleClient = createFakeGoogleClient({
      drive: [largeDriveDoc("Original plan. "), largeDriveDoc("Updated Google plan. ")]
    });
    const worker = createGoogleComposioIngestion({ ingestionPipeline: pipeline, googleClient });

    await worker.syncGoogle(baseSyncInput());
    const result = await worker.syncGoogle(baseSyncInput({ mode: "incremental" }));

    expect(googleClient.driveCalls[1]).toMatchObject({
      mode: "incremental",
      cursor: "drive_cursor_1"
    });
    expect(result.statuses).toEqual(["updated"]);
    expect(store.snapshot()?.artifacts).toHaveLength(1);
    expect(store.snapshot()?.artifacts[0].normalizedText).toContain("Updated Google plan");
  });

  it("blocks sync for revoked Google connected accounts", async () => {
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const googleClient = createFakeGoogleClient({ drive: [largeDriveDoc()] });
    const worker = createGoogleComposioIngestion({ ingestionPipeline: pipeline, googleClient });

    await expect(
      worker.syncGoogle(
        baseSyncInput({
          connectedAccount: {
            id: "acct_google",
            status: "revoked",
            principalId: "usr_admin"
          }
        })
      )
    ).rejects.toThrow(/revoked/i);

    expect(googleClient.driveCalls).toHaveLength(0);
  });

  it("rejects selected Google sources without the required connected-account scope", async () => {
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const googleClient = createFakeGoogleClient({ gmail: [gmailThread()] });
    const worker = createGoogleComposioIngestion({ ingestionPipeline: pipeline, googleClient });

    await expect(
      worker.syncGoogle(
        baseSyncInput({
          selectedSources: [
            {
              kind: "gmail",
              scope: "gmail.readonly",
              name: "Inbox",
              teams: ["revenue"],
              roles: ["admin", "reviewer"],
              sensitivity: "confidential"
            }
          ],
          allowedScopes: ["drive.readonly"]
        })
      )
    ).rejects.toThrow(/scope/i);

    expect(googleClient.gmailCalls).toHaveLength(0);
  });

  it("deduplicates repeated Drive and Gmail payloads through the shared ingestion path", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const googleClient = createFakeGoogleClient({
      drive: [largeDriveDoc(), largeDriveDoc()],
      gmail: [gmailThread(), gmailThread()]
    });
    const worker = createGoogleComposioIngestion({ ingestionPipeline: pipeline, googleClient });
    const input = baseSyncInput({
      selectedSources: [
        baseSyncInput().selectedSources[0],
        {
          kind: "gmail",
          scope: "gmail.readonly",
          name: "Inbox",
          teams: ["platform"],
          roles: ["admin", "reviewer", "operator", "agent"],
          sensitivity: "internal"
        }
      ]
    });

    await worker.syncGoogle(input);
    const duplicate = await worker.syncGoogle(input);

    expect(duplicate.statuses).toEqual(["duplicate", "duplicate"]);
    expect(store.snapshot()?.artifacts).toHaveLength(2);
  });

  it("commits, reviews, merges, and queries Google-derived artifacts with citations", async () => {
    const token = `google-derived-${Date.now()}`;
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const googleClient = createFakeGoogleClient({ drive: [largeDriveDoc(`The ${token} deployment policy is approved. `)] });
    const worker = createGoogleComposioIngestion({ ingestionPipeline: pipeline, googleClient });
    const sync = await worker.syncGoogle(baseSyncInput());
    const artifact = sync.artifacts[0];

    const commitResponse = await commitBrain(
      jsonRequest("/api/v1/brain/commit", {
        title: `Google policy ${token}`,
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
        note: "Google source evidence is sufficient."
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
