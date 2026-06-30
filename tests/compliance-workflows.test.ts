import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createComplianceWorkflows,
  type ComplianceState,
  type ComplianceStore
} from "../lib/compliance-workflows";
import type { BrainRepository } from "../lib/repository-contract";
import type { BrainEvent, BrainQueryResult, DashboardSnapshot, KnowledgeAtom, Principal, SourceArtifact } from "../lib/types";

const admin: Principal = {
  id: "usr_admin",
  name: "Admin",
  email: "admin@example.com",
  role: "admin",
  teams: ["platform", "revenue"],
  tiers: ["individual", "team", "department", "company-main", "exec-protected"],
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

const reviewer: Principal = {
  id: "usr_reviewer",
  name: "Reviewer",
  email: "reviewer@example.com",
  role: "reviewer",
  teams: ["platform"],
  tiers: ["individual", "team", "department"],
  scopes: ["brain:read", "brain:write", "audit:read"]
};

function memoryStore(initial?: Partial<ComplianceState>) {
  let state: ComplianceState | null = initial
    ? {
        retentionRules: [],
        legalHolds: [],
        retentionRuns: [],
        memoryExports: [],
        answerAuditPacks: [],
        tombstones: [],
        auditEvents: [],
        ...initial
      }
    : null;
  const store: ComplianceStore & { snapshot: () => ComplianceState | null } = {
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

function source(overrides: Partial<SourceArtifact> = {}): SourceArtifact {
  return {
    id: "src_slack_old",
    tenantId: "tenant_demo",
    sourceType: "slack",
    title: "Old Slack decision",
    uri: "https://slack.example.com/archives/platform/p/old",
    ownerId: "usr_employee",
    tier: "team",
    sensitivity: "internal",
    capturedAt: "2026-05-01T09:00:00.000Z",
    checksum: "sha256:old",
    ...overrides
  };
}

function atom(overrides: Partial<KnowledgeAtom> = {}): KnowledgeAtom {
  return {
    id: "atom_old",
    tenantId: "tenant_demo",
    title: "Old platform decision",
    body: "Legacy platform decision that is now outside the retention window.",
    atomType: "decision",
    tier: "team",
    ownerId: "usr_employee",
    sourceIds: ["src_slack_old"],
    acl: { teams: ["platform"], roles: ["admin", "reviewer", "employee"], sensitivity: "internal" },
    status: "approved",
    version: 1,
    confidence: 0.84,
    freshness: 0.25,
    reviewDueAt: "2026-05-15T00:00:00.000Z",
    createdAt: "2026-05-01T09:10:00.000Z",
    updatedAt: "2026-05-01T09:10:00.000Z",
    tags: ["platform", "legacy"],
    ...overrides
  };
}

const sources: SourceArtifact[] = [
  source(),
  source({
    id: "src_docs_hold",
    sourceType: "docs",
    title: "Held document",
    uri: "https://docs.example.com/held",
    checksum: "sha256:held"
  }),
  source({
    id: "src_recent",
    sourceType: "slack",
    title: "Recent Slack decision",
    uri: "https://slack.example.com/archives/platform/p/recent",
    capturedAt: "2026-06-28T09:00:00.000Z",
    checksum: "sha256:recent"
  })
];

const atoms: KnowledgeAtom[] = [
  atom(),
  atom({
    id: "atom_held",
    title: "Held platform decision",
    sourceIds: ["src_docs_hold"],
    createdAt: "2026-04-01T09:10:00.000Z",
    updatedAt: "2026-04-01T09:10:00.000Z"
  }),
  atom({
    id: "atom_recent",
    title: "Recent platform decision",
    sourceIds: ["src_recent"],
    createdAt: "2026-06-28T09:10:00.000Z",
    updatedAt: "2026-06-28T09:10:00.000Z",
    freshness: 0.98
  }),
  atom({
    id: "atom_restricted",
    title: "Exec restricted decision",
    tier: "exec-protected",
    ownerId: "usr_admin",
    sourceIds: ["src_slack_old"],
    acl: { teams: ["exec"], roles: ["admin"], sensitivity: "restricted" },
    createdAt: "2026-05-01T09:10:00.000Z",
    updatedAt: "2026-05-01T09:10:00.000Z"
  })
];

function event(overrides: Partial<BrainEvent> = {}): BrainEvent {
  return {
    id: "evt_review_old",
    tenantId: "tenant_demo",
    actorId: "usr_reviewer",
    action: "review",
    targetId: "atom_old",
    targetType: "atom",
    policyDecision: "allow",
    metadata: { changesetId: "cs_old", reviewAction: "approve" },
    createdAt: "2026-05-02T09:00:00.000Z",
    ...overrides
  };
}

const auditEvents: BrainEvent[] = [
  event(),
  event({
    id: "evt_tool_old",
    actorId: "agent_codex",
    action: "tool.invoke",
    targetId: "tool_slack_search",
    targetType: "tool",
    metadata: { atomIds: ["atom_old"], connectedAccountId: "acct_slack", sessionId: "sess_tool" },
    createdAt: "2026-06-29T09:00:00.000Z"
  }),
  event({
    id: "evt_cron_old",
    actorId: "agent_codex",
    action: "cron.run",
    targetId: "run_brain_health",
    targetType: "cron-run",
    metadata: { atomIds: ["atom_old"], cronJobId: "cron_brain_health", sessionId: "sess_cron" },
    createdAt: "2026-06-29T10:00:00.000Z"
  })
];

function dashboardSnapshot(): DashboardSnapshot {
  return {
    principal: admin,
    tiers: [],
    atoms: [...atoms],
    registry: [],
    changesets: [],
    cronRuns: [
      {
        id: "run_brain_health",
        cronJobId: "cron_brain_health",
        status: "succeeded",
        startedAt: "2026-06-29T10:00:00.000Z",
        finishedAt: "2026-06-29T10:00:05.000Z",
        durationMs: 5000,
        output: "Brain health completed.",
        auditEventIds: ["evt_cron_old"]
      }
    ],
    qualityScores: [],
    events: [...auditEvents]
  };
}

function queryResult(): BrainQueryResult {
  return {
    answer: "Highest authority match: Old platform decision.",
    citations: [atoms[0]],
    retrievedRegistry: [],
    events: [
      event({
        id: "evt_query_pack",
        actorId: "usr_admin",
        action: "query",
        targetId: "brain",
        metadata: { citations: ["atom_old"] },
        createdAt: "2026-06-30T08:00:00.000Z"
      })
    ],
    retrieval: {
      explanation: "Ranked by authority and freshness.",
      rankings: [
        {
          atomId: "atom_old",
          score: 0.91,
          factors: {
            lexical: 0.9,
            vector: 0.8,
            metadata: 0.7,
            graph: 0.6,
            tierAuthority: 0.7,
            freshness: 0.25,
            confidence: 0.84,
            status: 1,
            quality: 0.8
          }
        }
      ],
      denied: []
    },
    policy: { allowed: true, reasons: ["ACL and tier policy allowed this answer."] }
  };
}

function repository(): BrainRepository {
  return {
    dashboard: vi.fn(async () => dashboardSnapshot()),
    principal: vi.fn(async (id?: string) => (id === employee.id ? employee : id === reviewer.id ? reviewer : admin)),
    queryBrain: vi.fn(async () => queryResult()),
    commitBrain: vi.fn(),
    lineage: vi.fn(async (atomId: string) => ({
      atom: atoms.find((candidate) => candidate.id === atomId),
      edges: [{ id: `edge_${atomId}`, fromId: atomId, toId: "usr_reviewer", relation: "reviewed-by" as const }],
      events: auditEvents.filter((candidate) => candidate.targetId === atomId),
      sources: atoms.find((candidate) => candidate.id === atomId)?.sourceIds ?? []
    })),
    listChangesets: vi.fn(),
    reviewMemoryChangeset: vi.fn(),
    mergeMemoryChangeset: vi.fn(),
    searchRegistry: vi.fn(),
    createRegistryChangeset: vi.fn(),
    publishRegistryItem: vi.fn(),
    rollbackRegistryItem: vi.fn(),
    listCronJobs: vi.fn(),
    getCronJob: vi.fn(),
    runCronJob: vi.fn(),
    listCronRuns: vi.fn(),
    allRegistry: vi.fn(async () => []),
    allEvents: vi.fn(async () => [...auditEvents])
  };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("compliance workflows", () => {
  it("configures retention and records expired deletions by source, tier, and sensitivity", async () => {
    const service = createComplianceWorkflows({
      store: memoryStore(),
      repository: repository(),
      sourceArtifacts: sources,
      now: () => "2026-06-30T08:00:00.000Z"
    });

    await service.configureRetention({
      principal: admin,
      rules: [
        {
          id: "rule_slack_team_internal",
          sourceType: "slack",
          tier: "team",
          sensitivity: "internal",
          retentionDays: 30,
          deletionBehavior: "delete"
        }
      ]
    });
    const result = await service.runRetention({ principal: admin });

    expect(result.run.deletedAtomIds).toEqual(["atom_old"]);
    expect(result.run.heldAtomIds).toEqual([]);
    expect(result.run.reviewAtomIds).toEqual([]);
    expect(result.tombstones[0]).toMatchObject({ atomId: "atom_old", reason: "retention_expired" });
    expect(result.auditEvents.map((audit) => audit.action)).toEqual(expect.arrayContaining(["retention.run"]));
  });

  it("blocks retention deletion when legal hold is active", async () => {
    const store = memoryStore();
    const service = createComplianceWorkflows({
      store,
      repository: repository(),
      sourceArtifacts: sources,
      now: () => "2026-06-30T08:00:00.000Z"
    });

    await service.configureRetention({
      principal: admin,
      rules: [{ id: "rule_docs", sourceType: "docs", tier: "team", sensitivity: "internal", retentionDays: 30, deletionBehavior: "delete" }]
    });
    const hold = await service.placeLegalHold({ principal: admin, targetType: "atom", targetId: "atom_held", reason: "pending discovery" });
    const result = await service.runRetention({ principal: admin });

    expect(result.run.deletedAtomIds).toEqual([]);
    expect(result.run.heldAtomIds).toEqual(["atom_held"]);
    expect(hold.auditEvent).toMatchObject({ action: "legal-hold.apply", policyDecision: "allow" });
    expect(store.snapshot()?.auditEvents.map((audit) => audit.action)).toEqual(expect.arrayContaining(["legal-hold.apply", "retention.run"]));
  });

  it("exports individual memory with sources, lineage, and policy context", async () => {
    const service = createComplianceWorkflows({
      store: memoryStore(),
      repository: repository(),
      sourceArtifacts: sources,
      now: () => "2026-06-30T08:00:00.000Z"
    });

    const result = await service.exportMemory({
      principal: admin,
      scope: "individual",
      subjectPrincipalId: "usr_employee",
      includeRestricted: false
    });

    expect(result.record.status).toBe("completed");
    expect(result.record.atomIds).toEqual(expect.arrayContaining(["atom_old", "atom_held", "atom_recent"]));
    expect(result.record.sourceIds).toEqual(expect.arrayContaining(["src_slack_old", "src_docs_hold", "src_recent"]));
    expect(result.record.lineageByAtom.atom_old.events[0]).toMatchObject({ action: "review", actorId: "usr_reviewer" });
    expect(result.record.policyContext).toMatchObject({ scope: "individual", subjectPrincipalId: "usr_employee" });
  });

  it("builds answer audit packs from response to citations, sources, reviewers, policies, tools, and cron sessions", async () => {
    const service = createComplianceWorkflows({
      store: memoryStore(),
      repository: repository(),
      sourceArtifacts: sources,
      now: () => "2026-06-30T08:00:00.000Z"
    });

    const result = await service.buildAnswerAuditPack({ principal: admin, query: "What was the old platform decision?" });

    expect(result.pack.answer).toContain("Old platform decision");
    expect(result.pack.retrievedAtomIds).toEqual(["atom_old"]);
    expect(result.pack.sourceIds).toEqual(["src_slack_old"]);
    expect(result.pack.reviewers).toEqual(["usr_reviewer"]);
    expect(result.pack.policyDecisions[0]).toMatchObject({ allowed: true });
    expect(result.pack.toolEvents.map((tool) => tool.id)).toEqual(["evt_tool_old"]);
    expect(result.pack.cronEvents.map((cron) => cron.id)).toEqual(["evt_cron_old"]);
    expect(result.pack.sessionIds).toEqual(expect.arrayContaining(["sess_tool", "sess_cron"]));
  });

  it("denies forbidden organization export", async () => {
    const store = memoryStore();
    const service = createComplianceWorkflows({
      store,
      repository: repository(),
      sourceArtifacts: sources,
      now: () => "2026-06-30T08:00:00.000Z"
    });

    const result = await service.exportMemory({ principal: employee, scope: "organization" });

    expect(result.record.status).toBe("denied");
    expect(result.record.atomIds).toEqual([]);
    expect(result.record.deniedReasons.join(" ")).toMatch(/audit:read|admin/i);
    expect(result.auditEvent).toMatchObject({ policyDecision: "deny" });
  });

  it("serves retention, legal hold, export, audit pack, and status routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-compliance-"));
    process.env.COMPLIANCE_STATE_PATH = join(dir, "compliance.json");
    vi.resetModules();

    const configureRoute = await import("../app/api/v1/compliance/retention/configure/route");
    const runRoute = await import("../app/api/v1/compliance/retention/run/route");
    const holdRoute = await import("../app/api/v1/compliance/legal-holds/route");
    const exportRoute = await import("../app/api/v1/compliance/exports/route");
    const auditPackRoute = await import("../app/api/v1/compliance/audit-packs/route");
    const statusRoute = await import("../app/api/v1/compliance/status/route");

    const configured = await configureRoute.POST(
      jsonRequest("/api/v1/compliance/retention/configure", {
        principal: admin,
        rules: [{ id: "rule_seed", tier: "company-main", sensitivity: "internal", retentionDays: 1, deletionBehavior: "review" }]
      })
    );
    expect(configured.status).toBe(200);

    const hold = await holdRoute.POST(
      jsonRequest("/api/v1/compliance/legal-holds", { principal: admin, targetType: "atom", targetId: "atom_001", reason: "audit sample" })
    );
    expect(hold.status).toBe(200);

    const run = await runRoute.POST(jsonRequest("/api/v1/compliance/retention/run", { principal: admin }));
    expect(run.status).toBe(200);

    const exported = await exportRoute.POST(jsonRequest("/api/v1/compliance/exports", { principal: admin, scope: "organization", includeRestricted: true }));
    expect(exported.status).toBe(200);

    const pack = await auditPackRoute.POST(jsonRequest("/api/v1/compliance/audit-packs", { principal: admin, query: "promotion gates" }));
    expect(pack.status).toBe(200);

    const state = await statusRoute.GET();
    const body = await state.json();
    expect(body.retentionRules).toHaveLength(1);
    expect(body.legalHolds).toHaveLength(1);
    expect(body.retentionRuns).toHaveLength(1);
    expect(body.memoryExports).toHaveLength(1);
    expect(body.answerAuditPacks).toHaveLength(1);
    expect(body.auditEvents.length).toBeGreaterThanOrEqual(5);
  });
});
