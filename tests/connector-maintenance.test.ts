import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createConnectorMaintenanceAssistant,
  type ConnectorMaintenanceState,
  type ConnectorMaintenanceStore
} from "../lib/connector-maintenance";
import type { ComposioConnectedAccount, ComposioState } from "../lib/composio-control-plane";
import type { ComposioIngestionState, NormalizedComposioArtifact } from "../lib/composio-ingestion";
import type { KnowledgeAtom, Principal } from "../lib/types";

const admin: Principal = {
  id: "usr_admin",
  name: "Admin",
  email: "admin@example.com",
  role: "admin",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["brain:read", "brain:write", "audit:read"]
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

function createStore() {
  let state: ConnectorMaintenanceState | null = null;
  const store: ConnectorMaintenanceStore & { snapshot: () => ConnectorMaintenanceState | null } = {
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

function account(overrides: Partial<ComposioConnectedAccount> = {}): ComposioConnectedAccount {
  return {
    id: "acct_slack",
    toolkitSlug: "slack",
    authConfigId: "auth_slack",
    principalId: "usr_employee",
    status: "active",
    createdAt: "2026-06-30T06:00:00.000Z",
    updatedAt: "2026-06-30T06:00:00.000Z",
    ...overrides
  };
}

function controlState(accounts: ComposioConnectedAccount[] = [account()]): ComposioState {
  return {
    config: {
      projectId: "proj_123",
      baseUrl: "https://backend.composio.dev",
      apiKeyConfigured: true,
      apiKeyRef: "COMPOSIO_API_KEY",
      authConfigCount: 1,
      validatedAt: "2026-06-30T06:00:00.000Z",
      updatedAt: "2026-06-30T06:00:00.000Z"
    },
    connectedAccounts: accounts,
    sessions: [],
    registryCandidates: [],
    auditEvents: []
  };
}

function health(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-06-30T07:30:00.000Z",
    connectors: [
      {
        connector: "slack",
        connectedAccountId: "acct_slack",
        accountStatus: "active",
        toolkitSlug: "slack",
        lastCheckpoint: {
          id: "slack:acct_slack",
          connector: "slack",
          connectedAccountId: "acct_slack",
          cursor: "cursor_1",
          lastSourceObjectId: "msg_1",
          updatedAt: "2026-06-30T07:00:00.000Z"
        },
        lagSeconds: 1800,
        latestRun: {
          id: "run_1",
          connector: "slack",
          connectedAccountId: "acct_slack",
          status: "created",
          message: "Artifact created.",
          startedAt: "2026-06-30T07:00:00.000Z",
          finishedAt: "2026-06-30T07:00:01.000Z"
        },
        artifactCount: 1,
        recentErrors: [],
        revokedAt: undefined,
        ...overrides
      }
    ]
  };
}

function artifact(overrides: Partial<NormalizedComposioArtifact> = {}): NormalizedComposioArtifact {
  return {
    id: "src_employee_slack",
    tenantId: "tenant_demo",
    connector: "slack",
    sourceObjectId: "msg_1",
    connectedAccountId: "acct_slack",
    principalId: "usr_employee",
    provenanceUrl: "https://slack.example.com/msg_1",
    rawObjectKey: "composio/slack/msg_1/raw.json",
    raw: { text: "handoff" },
    normalizedText: "Employee handoff note.",
    acl: { teams: ["platform"], roles: ["admin", "reviewer", "employee"], sensitivity: "internal" },
    checksum: "sha256:artifact",
    source: {
      id: "src_employee_slack",
      tenantId: "tenant_demo",
      sourceType: "slack",
      title: "Employee handoff note",
      uri: "https://slack.example.com/msg_1",
      ownerId: "usr_employee",
      tier: "team",
      sensitivity: "internal",
      capturedAt: "2026-06-30T06:55:00.000Z",
      checksum: "sha256:artifact"
    },
    createdAt: "2026-06-30T06:55:00.000Z",
    updatedAt: "2026-06-30T06:55:00.000Z",
    ...overrides
  };
}

function atom(overrides: Partial<KnowledgeAtom> = {}): KnowledgeAtom {
  return {
    id: "atom_employee",
    tenantId: "tenant_demo",
    title: "Employee preference",
    body: "Employee owned preference.",
    atomType: "preference",
    tier: "individual",
    ownerId: "usr_employee",
    sourceIds: ["src_employee_slack"],
    acl: { teams: ["platform"], roles: ["admin", "reviewer", "employee"], sensitivity: "internal" },
    status: "approved",
    version: 1,
    confidence: 0.9,
    freshness: 0.9,
    reviewDueAt: "2026-07-30T00:00:00.000Z",
    createdAt: "2026-06-30T06:00:00.000Z",
    updatedAt: "2026-06-30T06:00:00.000Z",
    tags: ["offboarding"],
    ...overrides
  };
}

function ingestionState(overrides: Partial<ComposioIngestionState> = {}): ComposioIngestionState {
  return {
    artifacts: [artifact()],
    checkpoints: [],
    runs: [],
    auditEvents: [],
    ...overrides
  };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("connector maintenance assistant", () => {
  it("opens a reauthorization repair task for expired auth", async () => {
    const assistant = createConnectorMaintenanceAssistant({
      store: createStore(),
      connectorOps: { health: async () => health() },
      now: () => "2026-06-30T07:30:00.000Z"
    });

    const result = await assistant.triage({
      principal: admin,
      authExpiresAt: { acct_slack: "2026-06-30T07:00:00.000Z" }
    });

    expect(result.repairTasks[0]).toMatchObject({
      findingType: "expired-auth",
      connector: "slack",
      connectedAccountId: "acct_slack",
      recommendedAction: "Reauthorize the connected account before the next sync or tool invocation."
    });
    expect(result.repairTasks[0]?.checkpointId).toBe("slack:acct_slack");
  });

  it("opens a lag repair task when checkpoint lag exceeds the threshold", async () => {
    const assistant = createConnectorMaintenanceAssistant({
      store: createStore(),
      connectorOps: { health: async () => health({ lagSeconds: 7200 }) },
      now: () => "2026-06-30T07:30:00.000Z"
    });

    const result = await assistant.triage({ principal: admin, lagThresholdSeconds: 3600 });

    expect(result.repairTasks[0]).toMatchObject({
      findingType: "lag-spike",
      recommendedAction: "Replay from the last healthy checkpoint and inspect connector queue depth."
    });
    expect(result.repairTasks[0]?.evidence).toContain("lagSeconds:7200");
  });

  it("opens a transform repair task for repeated transform failures", async () => {
    const recentErrors = [0, 1, 2].map((index) => ({
      id: `run_fail_${index}`,
      status: "failed",
      connector: "slack",
      connectedAccountId: "acct_slack",
      sourceObjectId: `msg_${index}`,
      message: "Transform failed while normalizing payload.",
      startedAt: "2026-06-30T07:00:00.000Z",
      finishedAt: "2026-06-30T07:00:01.000Z",
      guidance: "Check connector permissions, source scope, checkpoint cursor, and connected-account status before retrying."
    }));
    const assistant = createConnectorMaintenanceAssistant({
      store: createStore(),
      connectorOps: { health: async () => health({ recentErrors }) },
      now: () => "2026-06-30T07:30:00.000Z"
    });

    const result = await assistant.triage({ principal: admin, repeatedFailureThreshold: 3 });

    expect(result.repairTasks[0]).toMatchObject({
      findingType: "repeated-transform-failure",
      recommendedAction: "Inspect the transform mapping, sample payload shape, and sanitizer before replaying."
    });
    expect(result.repairTasks[0]?.evidence).toContain("transformFailures:3");
  });

  it("exports allowed individual-owned atoms and artifacts during offboarding", async () => {
    const assistant = createConnectorMaintenanceAssistant({
      store: createStore(),
      controlPlane: { getState: async () => controlState() },
      ingestionPipeline: { getState: async () => ingestionState() },
      knowledgeAtoms: [atom()],
      now: () => "2026-06-30T07:30:00.000Z"
    });

    const result = await assistant.offboard({
      principal: admin,
      subjectPrincipalId: "usr_employee",
      accountAction: "remap",
      remapToPrincipalId: "usr_admin"
    });

    expect(result.exportRecord.status).toBe("completed");
    expect(result.exportRecord.exportedAtomIds).toEqual(["atom_employee"]);
    expect(result.exportRecord.exportedArtifactIds).toEqual(["src_employee_slack"]);
    expect(result.exportRecord.remappedAccountIds).toEqual(["acct_slack"]);
  });

  it("revokes connected-account access and audits revocation", async () => {
    const revoked: string[] = [];
    const assistant = createConnectorMaintenanceAssistant({
      store: createStore(),
      controlPlane: {
        getState: async () => controlState(),
        revokeConnectedAccount: async (accountId) => {
          revoked.push(accountId);
          return account({ id: accountId, status: "revoked" });
        }
      },
      ingestionPipeline: { getState: async () => ingestionState() },
      knowledgeAtoms: [atom()],
      now: () => "2026-06-30T07:30:00.000Z"
    });

    const result = await assistant.offboard({ principal: admin, subjectPrincipalId: "usr_employee", accountAction: "revoke" });

    expect(revoked).toEqual(["acct_slack"]);
    expect(result.exportRecord.revokedAccountIds).toEqual(["acct_slack"]);
    expect(result.auditEvents.map((event) => event.action)).toContain("access.revoke");
  });

  it("denies export for principals without audit authority", async () => {
    const assistant = createConnectorMaintenanceAssistant({
      store: createStore(),
      controlPlane: { getState: async () => controlState() },
      ingestionPipeline: { getState: async () => ingestionState() },
      knowledgeAtoms: [atom()],
      now: () => "2026-06-30T07:30:00.000Z"
    });

    const result = await assistant.offboard({ principal: employee, subjectPrincipalId: "usr_employee", accountAction: "revoke" });

    expect(result.exportRecord.status).toBe("denied");
    expect(result.exportRecord.revokedAccountIds).toHaveLength(0);
    expect(result.exportRecord.deniedReasons).toContain("audit:read scope or admin role is required for offboarding export.");
    expect(result.auditEvents[0]).toMatchObject({ policyDecision: "deny" });
  });

  it("serves triage, offboarding, and status through API routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-connector-maintenance-"));
    process.env.CONNECTOR_MAINTENANCE_STATE_PATH = join(dir, "maintenance.json");
    vi.resetModules();
    const triageRoute = await import("../app/api/v1/connector-maintenance/triage/route");
    const offboardingRoute = await import("../app/api/v1/offboarding/run/route");
    const statusRoute = await import("../app/api/v1/connector-maintenance/status/route");

    const triage = await triageRoute.POST(
      jsonRequest("/api/v1/connector-maintenance/triage", {
        principal: admin,
        health: health({ lagSeconds: 7200 }),
        lagThresholdSeconds: 3600
      })
    );
    const offboarding = await offboardingRoute.POST(
      jsonRequest("/api/v1/offboarding/run", {
        principal: admin,
        controlState: controlState(),
        ingestionState: ingestionState(),
        knowledgeAtoms: [atom()],
        subjectPrincipalId: "usr_employee",
        accountAction: "remap",
        remapToPrincipalId: "usr_admin"
      })
    );
    const status = await statusRoute.GET();
    const state = await status.json();

    expect(triage.status).toBe(200);
    expect(offboarding.status).toBe(200);
    expect(state.triageRuns).toHaveLength(1);
    expect(state.offboardingExports).toHaveLength(1);
  });
});
