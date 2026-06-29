import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createBrainHealthAgent, type BrainHealthAgentState, type BrainHealthAgentStore } from "../lib/brain-health-agent";
import type { KnowledgeAtom, Principal, QualityScore } from "../lib/types";
import type { MemoryConflictRecord } from "../lib/memory-conflicts";

const admin: Principal = {
  id: "usr_admin",
  name: "Admin",
  email: "admin@example.com",
  role: "admin",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["cron:run", "brain:write", "registry:read"]
};

function createStore() {
  let state: BrainHealthAgentState | null = null;
  const store: BrainHealthAgentStore & { snapshot: () => BrainHealthAgentState | null } = {
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

function atom(overrides: Partial<KnowledgeAtom> = {}): KnowledgeAtom {
  return {
    id: "atom_stale",
    tenantId: "tenant_demo",
    title: "Stale launch policy",
    body: "Old launch policy needs refresh.",
    atomType: "policy",
    tier: "team",
    ownerId: "usr_owner",
    sourceIds: ["src_policy"],
    acl: { teams: ["platform"], roles: ["admin", "reviewer"], sensitivity: "internal" },
    status: "stale",
    version: 1,
    confidence: 0.7,
    freshness: 0.25,
    reviewDueAt: "2026-06-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    tags: ["launch"],
    ...overrides
  };
}

function score(atomId: string, overrides: Partial<QualityScore> = {}): QualityScore {
  return {
    id: `score_${atomId}`,
    subjectId: atomId,
    subjectType: "atom",
    score: 42,
    evidenceStrength: 30,
    freshness: 25,
    specificity: 70,
    actionability: 80,
    conflictRisk: 15,
    reuse: 40,
    reviewerTrust: 70,
    retractionPenalty: 0,
    notes: [],
    ...overrides
  };
}

function conflict(candidateAtomId = "atom_stale"): MemoryConflictRecord {
  const base = atom({ id: candidateAtomId });
  return {
    id: "conflict_1",
    conflictType: "stale-supersession",
    candidateAtomId,
    existingAtomId: "atom_existing",
    recommendedResolution: "supersede-stale",
    status: "review",
    compared: {
      candidate: {
        atomId: base.id,
        title: base.title,
        body: base.body,
        sourceIds: base.sourceIds,
        tier: base.tier,
        freshness: base.freshness,
        confidence: base.confidence,
        ownerId: base.ownerId,
        status: base.status
      },
      existing: {
        atomId: "atom_existing",
        title: "New launch policy",
        body: "New policy supersedes old guidance.",
        sourceIds: ["src_new"],
        tier: "team",
        freshness: 0.9,
        confidence: 0.9,
        ownerId: "usr_owner",
        status: "approved"
      }
    },
    changeset: {
      id: "cs_conflict",
      tenantId: "tenant_demo",
      title: "Supersede stale launch policy",
      targetType: "atom",
      targetId: candidateAtomId,
      tier: "team",
      authorId: "usr_admin",
      ownerId: "usr_owner",
      reviewers: ["usr_reviewer"],
      status: "review",
      summary: "Existing conflict changeset.",
      checks: [],
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z"
    },
    similarity: 0.88,
    createdAt: "2026-06-29T10:00:00.000Z",
    updatedAt: "2026-06-29T10:00:00.000Z"
  };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("brain health agent", () => {
  it("enables the weekly brain health job", async () => {
    const agent = createBrainHealthAgent({ store: createStore(), now: () => "2026-06-29T10:00:00.000Z" });

    const job = await agent.enableWeeklyJob({
      ownerId: "usr_admin",
      tier: "company-main",
      budgetUsd: 8,
      outputDestination: "dashboard://brain-health"
    });

    expect(job).toMatchObject({
      schedule: "0 9 * * MON",
      timezone: "UTC",
      ownerId: "usr_admin",
      tier: "company-main",
      budgetUsd: 8,
      outputDestination: "dashboard://brain-health"
    });
  });

  it("opens actionable changesets with linked evidence during a normal run", async () => {
    const store = createStore();
    const agent = createBrainHealthAgent({ store, now: () => "2026-06-29T10:00:00.000Z" });
    await agent.enableWeeklyJob({ ownerId: "usr_admin", tier: "company-main", budgetUsd: 8, outputDestination: "dashboard://brain-health" });

    const result = await agent.run({
      principal: admin,
      atoms: [atom(), atom({ id: "atom_missing_owner", title: "Ownerless playbook", ownerId: "" })],
      qualityScores: [score("atom_stale"), score("atom_missing_owner", { score: 70 })],
      conflicts: [conflict()],
      sourceHealth: { src_policy: 25 },
      failedQueries: { atom_stale: 3 }
    });

    expect(result.status).toBe("succeeded");
    expect(result.recommendations.map((item) => item.action)).toEqual(expect.arrayContaining(["refresh", "assign-owner", "supersede"]));
    expect(result.changesets.length).toBeGreaterThanOrEqual(3);
    expect(result.report.recommendations[0]).toMatchObject({
      affectedAtomId: expect.any(String),
      reviewerId: "usr_reviewer",
      policyContext: expect.stringMatching(/brain-health/i),
      sourceData: expect.any(Array)
    });
  });

  it("creates no changesets for a healthy no-op run", async () => {
    const agent = createBrainHealthAgent({ store: createStore() });
    await agent.enableWeeklyJob({ ownerId: "usr_admin", tier: "team", budgetUsd: 4, outputDestination: "dashboard://brain-health" });

    const result = await agent.run({
      principal: admin,
      atoms: [atom({ id: "atom_healthy", status: "approved", freshness: 0.95, ownerId: "usr_owner" })],
      qualityScores: [score("atom_healthy", { score: 91, freshness: 95, evidenceStrength: 90, conflictRisk: 0 })],
      conflicts: [],
      sourceHealth: { src_policy: 90 },
      failedQueries: {}
    });

    expect(result.status).toBe("succeeded");
    expect(result.recommendations).toHaveLength(0);
    expect(result.changesets).toHaveLength(0);
  });

  it("pauses before changesets when approval is required", async () => {
    const agent = createBrainHealthAgent({ store: createStore() });
    await agent.enableWeeklyJob({ ownerId: "usr_admin", tier: "team", budgetUsd: 4, outputDestination: "dashboard://brain-health", approvalGates: ["exec-review"] });

    const result = await agent.run({
      principal: admin,
      atoms: [atom()],
      qualityScores: [score("atom_stale")],
      conflicts: [],
      sourceHealth: {},
      failedQueries: {}
    });

    expect(result.status).toBe("needs-approval");
    expect(result.changesets).toHaveLength(0);
    expect(result.approval?.reviewerContext).toMatch(/exec-review/);
  });

  it("fails when budget is exhausted", async () => {
    const agent = createBrainHealthAgent({ store: createStore() });
    await agent.enableWeeklyJob({ ownerId: "usr_admin", tier: "team", budgetUsd: 0, outputDestination: "dashboard://brain-health" });

    const result = await agent.run({ principal: admin, atoms: [atom()], qualityScores: [score("atom_stale")], conflicts: [], sourceHealth: {}, failedQueries: {} });

    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/budget/i);
  });

  it("prevents duplicate open changesets for the same recommendation", async () => {
    const agent = createBrainHealthAgent({ store: createStore(), now: () => "2026-06-29T10:00:00.000Z" });
    await agent.enableWeeklyJob({ ownerId: "usr_admin", tier: "team", budgetUsd: 4, outputDestination: "dashboard://brain-health" });
    const input = { principal: admin, atoms: [atom()], qualityScores: [score("atom_stale")], conflicts: [], sourceHealth: {}, failedQueries: {} };

    const first = await agent.run(input);
    const second = await agent.run(input);

    expect(first.changesets.length).toBeGreaterThan(0);
    expect(second.changesets).toHaveLength(0);
    expect(second.duplicatesSuppressed).toBeGreaterThan(0);
  });

  it("serves enable, run, and status through API routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "company-brain-health-agent-"));
    process.env.BRAIN_HEALTH_AGENT_STATE_PATH = join(dir, "health.json");
    vi.resetModules();
    const enableRoute = await import("../app/api/v1/brain-health/enable/route");
    const runRoute = await import("../app/api/v1/brain-health/run/route");
    const statusRoute = await import("../app/api/v1/brain-health/status/route");

    const enabled = await enableRoute.POST(jsonRequest("/api/v1/brain-health/enable", { ownerId: "usr_admin", tier: "team", budgetUsd: 4, outputDestination: "dashboard://brain-health" }));
    const run = await runRoute.POST(
      jsonRequest("/api/v1/brain-health/run", {
        principal: admin,
        atoms: [atom()],
        qualityScores: [score("atom_stale")],
        conflicts: [],
        sourceHealth: {},
        failedQueries: {}
      })
    );
    const status = await statusRoute.GET();
    const payload = await status.json();

    expect(enabled.status).toBe(200);
    expect(run.status).toBe(200);
    expect(payload.runs.length).toBe(1);
  });
});
