import { describe, expect, it } from "vitest";
import { createComposioIngestionPipeline, type ComposioIngestionState, type ComposioIngestionStore } from "../lib/composio-ingestion";
import { canInvokeRegistryItem } from "../lib/policy";
import { rankHybridAtoms } from "../lib/hybrid-retrieval";
import {
  createMeetingCrmComposioIngestion,
  type MeetingCrmComposioClient,
  type MeetingCrmSyncInput
} from "../lib/meeting-crm-composio-ingestion";
import type { KnowledgeAtom, Principal, ToolDefinition } from "../lib/types";

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

const reviewer: Principal = {
  id: "usr_reviewer",
  name: "Reviewer",
  email: "reviewer@example.com",
  role: "reviewer",
  teams: ["revenue"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["brain:read", "tool:invoke"]
};

const employee: Principal = {
  id: "usr_employee",
  name: "Employee",
  email: "employee@example.com",
  role: "employee",
  teams: ["platform"],
  tiers: ["individual", "team"],
  scopes: ["brain:read"]
};

function baseInput(overrides: Partial<MeetingCrmSyncInput> = {}): MeetingCrmSyncInput {
  return {
    principalId: "usr_reviewer",
    mode: "backfill",
    connectedAccount: {
      id: "acct_revenue",
      status: "active",
      principalId: "usr_reviewer"
    },
    selectedSources: [
      {
        kind: "zoom",
        scope: "zoom:account:recordings",
        name: "Zoom recordings",
        teams: ["revenue"],
        roles: ["admin", "reviewer", "operator", "agent"],
        sensitivity: "confidential",
        coverage: { acl: true, delta: true, webhook: true }
      }
    ],
    allowedScopes: ["zoom:account:recordings", "google-meet:drive:transcripts", "salesforce:org:enterprise", "hubspot:portal:revenue"],
    ...overrides
  };
}

type MeetingFixturePage = {
  items: Array<{
    id: string;
    title: string;
    url: string;
    provider: "zoom";
    participants: Array<{ name: string; email: string; role: string }>;
    startedAt: string;
    endedAt: string;
    transcript: Array<{ speaker: string; startSeconds: number; endSeconds: number; text: string }>;
    recording: { id: string; url: string; durationSeconds: number; fileType: string };
    sensitivity: "confidential";
  }>;
  nextCursor?: string;
};

function meetingPage(nextCursor = "zoom_cursor_1"): MeetingFixturePage {
  return {
    items: [
      {
        id: "zoom_123",
        title: "Enterprise renewal call",
        url: "https://zoom.us/rec/share/zoom_123",
        provider: "zoom" as const,
        participants: [
          { name: "Asha Rao", email: "asha@example.com", role: "host" },
          { name: "Customer CFO", email: "cfo@customer.example", role: "external" }
        ],
        startedAt: "2026-06-30T06:00:00.000Z",
        endedAt: "2026-06-30T06:45:00.000Z",
        transcript: [
          { speaker: "Asha Rao", startSeconds: 0, endSeconds: 30, text: "We reviewed the renewal timeline." },
          { speaker: "Customer CFO", startSeconds: 31, endSeconds: 55, text: "Budget approval needs security signoff." }
        ],
        recording: {
          id: "rec_123",
          url: "https://zoom.us/recording/rec_123",
          durationSeconds: 2700,
          fileType: "mp4"
        },
        sensitivity: "confidential" as const
      }
    ],
    nextCursor
  };
}

function crmPage(id = "sf_1", nextCursor?: string) {
  return {
    items: [
      {
        id,
        type: "deal" as const,
        title: `Enterprise renewal ${id}`,
        url: `https://salesforce.example.com/${id}`,
        account: { id: "acct_customer", name: "Acme Corp", domain: "acme.example" },
        deal: { id: "deal_1", name: "Acme renewal", stage: "Security review", amount: 250000 },
        owner: { id: "owner_1", name: "Revenue Owner", email: "owner@example.com" },
        updatedAt: "2026-06-30T07:00:00.000Z",
        body: "Customer requires restricted security review before renewal.",
        permissions: { groups: ["Revenue"], users: ["owner@example.com"] }
      }
    ],
    nextCursor
  };
}

function createFakeClient(input: {
  meetings?: MeetingFixturePage[];
  salesforce?: ReturnType<typeof crmPage>[];
  hubspot?: ReturnType<typeof crmPage>[];
}): MeetingCrmComposioClient & {
  meetingCalls: MeetingCrmSyncInput[];
  salesforceCalls: MeetingCrmSyncInput[];
  hubspotCalls: MeetingCrmSyncInput[];
} {
  return {
    meetingCalls: [],
    salesforceCalls: [],
    hubspotCalls: [],
    async fetchMeetings(inputPayload) {
      this.meetingCalls.push(inputPayload);
      const index = Math.min(this.meetingCalls.length - 1, (input.meetings?.length ?? 1) - 1);
      return input.meetings?.[index] ?? { items: [], nextCursor: undefined };
    },
    async fetchSalesforce(inputPayload) {
      this.salesforceCalls.push(inputPayload);
      const index = Math.min(this.salesforceCalls.length - 1, (input.salesforce?.length ?? 1) - 1);
      return input.salesforce?.[index] ?? { items: [], nextCursor: undefined };
    },
    async fetchHubSpot(inputPayload) {
      this.hubspotCalls.push(inputPayload);
      const index = Math.min(this.hubspotCalls.length - 1, (input.hubspot?.length ?? 1) - 1);
      return input.hubspot?.[index] ?? { items: [], nextCursor: undefined };
    }
  };
}

function restrictedAtomFromArtifact(body: string): KnowledgeAtom {
  return {
    id: "atom_restricted_customer",
    tenantId: "tenant_demo",
    title: "Restricted Acme renewal",
    body,
    atomType: "claim",
    tier: "exec-protected",
    ownerId: "usr_reviewer",
    sourceIds: ["src_restricted_customer"],
    acl: {
      teams: ["revenue"],
      roles: ["admin", "reviewer"],
      sensitivity: "restricted"
    },
    status: "approved",
    version: 1,
    confidence: 0.9,
    freshness: 0.95,
    reviewDueAt: "2026-07-30T00:00:00.000Z",
    createdAt: "2026-06-30T07:00:00.000Z",
    updatedAt: "2026-06-30T07:00:00.000Z",
    tags: ["crm", "restricted", "customer"]
  };
}

function crmTool(): ToolDefinition {
  return {
    id: "tool_salesforce_write",
    tenantId: "tenant_demo",
    kind: "tool",
    name: "Salesforce write",
    slug: "salesforce-write",
    description: "Write Salesforce through Composio.",
    tier: "exec-protected",
    ownerId: "usr_reviewer",
    version: "1.0.0",
    status: "published",
    permissions: ["composio:salesforce:write"],
    dependencies: [],
    requiredTools: [],
    adapterTargets: ["generic-mcp"],
    updatedAt: "2026-06-30T07:00:00.000Z",
    toolType: "connector",
    inputSchema: {},
    rateLimit: "60/minute",
    secrets: ["COMPOSIO_API_KEY"],
    auditPolicy: "restricted"
  };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("Meeting and CRM Composio ingestion", () => {
  it("syncs Zoom transcript artifacts with provenance, participants, time ranges, recording metadata, and sensitivity", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const client = createFakeClient({ meetings: [meetingPage(), { items: [], nextCursor: undefined }] });
    const worker = createMeetingCrmComposioIngestion({ ingestionPipeline: pipeline, meetingCrmClient: client });

    const result = await worker.syncMeetingCrm(baseInput());

    expect(result.artifacts[0]).toMatchObject({
      connector: "zoom",
      sourceObjectId: "zoom:acct_revenue:zoom_123",
      source: {
        sourceType: "meeting",
        title: "Enterprise renewal call",
        capturedAt: "2026-06-30T06:45:00.000Z"
      },
      acl: {
        sensitivity: "confidential",
        teams: ["revenue"]
      }
    });
    expect(result.artifacts[0].normalizedText).toContain("Participant: Customer CFO <cfo@customer.example> external");
    expect(result.artifacts[0].normalizedText).toContain("Time range: 2026-06-30T06:00:00.000Z - 2026-06-30T06:45:00.000Z");
    expect(result.artifacts[0].normalizedText).toContain("Recording: rec_123 mp4 2700s https://zoom.us/recording/rec_123");
    expect(store.snapshot()?.checkpoints[0]).toMatchObject({ connector: "zoom", cursor: "zoom_cursor_1" });
  });

  it("paginates CRM sources and preserves account, deal, owner, timestamp, and permission metadata", async () => {
    const store = createMemoryStore();
    const pipeline = createComposioIngestionPipeline({ store });
    const client = createFakeClient({
      salesforce: [crmPage("sf_1", "sf_cursor_1"), crmPage("sf_2")],
      hubspot: [crmPage("hs_1", "hs_cursor_1"), crmPage("hs_2")]
    });
    const worker = createMeetingCrmComposioIngestion({ ingestionPipeline: pipeline, meetingCrmClient: client });

    const result = await worker.syncMeetingCrm(
      baseInput({
        selectedSources: [
          {
            kind: "salesforce",
            scope: "salesforce:org:enterprise",
            name: "Salesforce enterprise",
            teams: ["revenue"],
            roles: ["admin", "reviewer", "operator", "agent"],
            sensitivity: "restricted",
            coverage: { acl: true, delta: true, webhook: true }
          },
          {
            kind: "hubspot",
            scope: "hubspot:portal:revenue",
            name: "HubSpot revenue",
            teams: ["revenue"],
            roles: ["admin", "reviewer", "operator", "agent"],
            sensitivity: "confidential",
            coverage: { acl: true, delta: true, webhook: true }
          }
        ]
      })
    );

    expect(client.salesforceCalls).toHaveLength(2);
    expect(client.hubspotCalls).toHaveLength(2);
    expect(result.statuses).toEqual(["created", "created", "created", "created"]);
    expect(result.artifacts[0].normalizedText).toContain("Account: Acme Corp <acme.example>");
    expect(result.artifacts[0].normalizedText).toContain("Deal: Acme renewal Security review 250000");
    expect(result.artifacts[0].normalizedText).toContain("Owner: Revenue Owner <owner@example.com>");
    expect(result.artifacts[0].normalizedText).toContain("Permission groups: Revenue");
  });

  it("excludes restricted customer memory from unauthorized retrieval and agent tool access", async () => {
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const client = createFakeClient({ salesforce: [crmPage("sf_restricted")] });
    const worker = createMeetingCrmComposioIngestion({ ingestionPipeline: pipeline, meetingCrmClient: client });
    const sync = await worker.syncMeetingCrm(
      baseInput({
        selectedSources: [
          {
            kind: "salesforce",
            scope: "salesforce:org:enterprise",
            name: "Salesforce enterprise",
            teams: ["revenue"],
            roles: ["admin", "reviewer"],
            sensitivity: "restricted",
            coverage: { acl: true, delta: true, webhook: true }
          }
        ]
      })
    );
    const atom = restrictedAtomFromArtifact(sync.artifacts[0].normalizedText);

    const retrieval = rankHybridAtoms({ query: "Acme renewal security", principal: employee, atoms: [atom] });

    expect(retrieval.citations).toHaveLength(0);
    expect(retrieval.denied[0]?.atom.id).toBe("atom_restricted_customer");
    expect(canInvokeRegistryItem(employee, crmTool())).toMatchObject({ allowed: false });
    expect(canInvokeRegistryItem(employee, crmTool()).reason).toMatch(/exec-protected|write-capable/i);
  });

  it("blocks revoked meeting/CRM connected accounts before client calls", async () => {
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const client = createFakeClient({ meetings: [meetingPage()] });
    const worker = createMeetingCrmComposioIngestion({ ingestionPipeline: pipeline, meetingCrmClient: client });

    await expect(
      worker.syncMeetingCrm(
        baseInput({
          connectedAccount: {
            id: "acct_revenue",
            status: "revoked",
            principalId: "usr_reviewer"
          }
        })
      )
    ).rejects.toThrow(/revoked/i);

    expect(client.meetingCalls).toHaveLength(0);
  });

  it("documents and blocks native fallback requirements for insufficient meeting/CRM coverage", async () => {
    const pipeline = createComposioIngestionPipeline({ store: createMemoryStore() });
    const client = createFakeClient({ salesforce: [crmPage()] });
    const worker = createMeetingCrmComposioIngestion({ ingestionPipeline: pipeline, meetingCrmClient: client });
    const input = baseInput({
      selectedSources: [
        {
          kind: "salesforce",
          scope: "salesforce:org:restricted",
          name: "Restricted Salesforce",
          teams: ["revenue"],
          roles: ["admin", "reviewer"],
          sensitivity: "restricted",
          coverage: { acl: false, delta: true, webhook: false }
        }
      ],
      allowedScopes: ["salesforce:org:restricted"]
    });

    expect(worker.fallbackRequirements(input)[0]).toMatchObject({
      sourceKind: "salesforce",
      scope: "salesforce:org:restricted",
      requiredAdapter: "native",
      status: "blocked",
      missingCapabilities: ["acl", "webhook"]
    });
    await expect(worker.syncMeetingCrm(input)).rejects.toThrow(/native fallback/i);
    expect(client.salesforceCalls).toHaveLength(0);
  });

  it("serves meeting/CRM sync and status through API routes", async () => {
    const syncRoute = await import("../app/api/v1/ingestion/meeting-crm/sync/route");
    const statusRoute = await import("../app/api/v1/ingestion/meeting-crm/status/route");
    const response = await syncRoute.POST(
      jsonRequest("/api/v1/ingestion/meeting-crm/sync", {
        ...baseInput(),
        mockPages: { meetings: [meetingPage(), { items: [], nextCursor: undefined }] }
      })
    );
    const payload = await response.json();
    const status = await statusRoute.GET();
    const state = await status.json();

    expect(response.status).toBe(200);
    expect(payload.artifacts[0].connector).toBe("zoom");
    expect(state.artifacts).toBeDefined();
  });
});
