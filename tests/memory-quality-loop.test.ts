import { describe, expect, it } from "vitest";
import { rankHybridAtoms } from "../lib/hybrid-retrieval";
import { createMemoryQualityLoop, type MemoryQualityState, type MemoryQualityStore } from "../lib/memory-quality-loop";
import type { KnowledgeAtom, Principal, QualityScore } from "../lib/types";

const reviewer: Principal = {
  id: "usr_reviewer",
  name: "Reviewer",
  email: "reviewer@example.com",
  role: "reviewer",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["brain:read", "brain:write"]
};

function createStore(initial?: Partial<MemoryQualityState>) {
  let state: MemoryQualityState | null = initial
    ? {
        scores: [],
        queue: [],
        auditEvents: [],
        ...initial
      }
    : null;

  const store: MemoryQualityStore & { snapshot: () => MemoryQualityState | null } = {
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
    id: "atom_quality",
    tenantId: "tenant_demo",
    title: "Connector review policy",
    body: "Weekly connector review is required for source-backed Composio integrations.",
    atomType: "policy",
    tier: "team",
    ownerId: "usr_admin",
    sourceIds: ["src_001"],
    acl: {
      teams: ["platform"],
      roles: ["admin", "reviewer", "operator", "agent"],
      sensitivity: "internal"
    },
    status: "approved",
    version: 1,
    confidence: 0.8,
    freshness: 0.8,
    reviewDueAt: "2026-07-06T10:00:00.000Z",
    createdAt: "2026-06-29T10:00:00.000Z",
    updatedAt: "2026-06-29T10:00:00.000Z",
    tags: ["connector", "review", "source-linked"],
    ...overrides
  };
}

function score(subjectId: string, value: number): QualityScore {
  return {
    id: `quality_${subjectId}`,
    subjectId,
    subjectType: "atom",
    score: value,
    evidenceStrength: value,
    freshness: value,
    specificity: value,
    actionability: value,
    conflictRisk: 100 - value,
    reuse: value,
    reviewerTrust: value,
    retractionPenalty: 0,
    notes: []
  };
}

describe("memory quality loop", () => {
  it("queues stale low-source-health atoms for refresh or demotion", async () => {
    const loop = createMemoryQualityLoop({ store: createStore(), now: () => "2026-06-29T10:00:00.000Z" });
    const result = await loop.run({
      atoms: [
        atom({
          id: "atom_stale",
          status: "stale",
          freshness: 0.12,
          confidence: 0.42,
          sourceIds: []
        })
      ],
      sourceHealth: { atom_stale: 20 },
      usage: { atom_stale: { retrievals: 1, successfulAnswers: 0 } },
      corrections: { atom_stale: 0 },
      conflicts: { atom_stale: 0 }
    });

    expect(result.scores[0]).toMatchObject({
      subjectId: "atom_stale",
      score: expect.any(Number),
      notes: expect.arrayContaining([expect.stringMatching(/stale|source/i)])
    });
    expect(result.queue[0]).toMatchObject({
      atomId: "atom_stale",
      status: "open",
      recommendedAction: "demote"
    });
  });

  it("records reviewer demotion with audit events", async () => {
    const store = createStore();
    const loop = createMemoryQualityLoop({ store, now: () => "2026-06-29T10:00:00.000Z" });
    const run = await loop.run({
      atoms: [atom({ id: "atom_low", freshness: 0.2, confidence: 0.35 })],
      sourceHealth: { atom_low: 40 },
      usage: {},
      corrections: { atom_low: 2 },
      conflicts: { atom_low: 1 }
    });

    const reviewItem = run.queue[0];
    expect(reviewItem).toBeDefined();

    const resolution = await loop.resolve({
      itemId: reviewItem!.id,
      reviewer,
      action: "demote",
      note: "Demote until the owner refreshes the source."
    });

    expect(resolution.item).toMatchObject({
      status: "resolved",
      resolution: {
        action: "demote",
        reviewerId: "usr_reviewer"
      }
    });
    expect(resolution.auditEvent).toMatchObject({
      action: "review",
      targetId: reviewItem!.id,
      metadata: expect.objectContaining({ action: "demote" })
    });
  });

  it("penalizes correction feedback and conflict history in score updates", async () => {
    const loop = createMemoryQualityLoop({ store: createStore() });
    const clean = await loop.run({
      atoms: [atom({ id: "atom_clean" })],
      sourceHealth: { atom_clean: 95 },
      usage: { atom_clean: { retrievals: 20, successfulAnswers: 18 } },
      corrections: { atom_clean: 0 },
      conflicts: { atom_clean: 0 }
    });
    const corrected = await loop.run({
      atoms: [atom({ id: "atom_corrected" })],
      sourceHealth: { atom_corrected: 95 },
      usage: { atom_corrected: { retrievals: 20, successfulAnswers: 8 } },
      corrections: { atom_corrected: 5 },
      conflicts: { atom_corrected: 2 }
    });

    expect(clean.scores[0]!.score).toBeGreaterThan(corrected.scores[0]!.score);
    expect(corrected.queue[0]!.recommendedAction).toBe("refresh");
  });

  it("lets retrieval ranking use quality scores", () => {
    const lowQuality = atom({
      id: "atom_low_quality",
      tier: "company-main",
      title: "Connector review policy",
      body: "Connector review policy requires source evidence.",
      freshness: 0.9,
      confidence: 0.85
    });
    const highQuality = atom({
      id: "atom_high_quality",
      tier: "team",
      title: "Connector review policy",
      body: "Connector review policy requires source evidence.",
      freshness: 0.9,
      confidence: 0.85
    });

    const result = rankHybridAtoms({
      query: "connector review policy",
      principal: reviewer,
      atoms: [lowQuality, highQuality],
      qualityScores: [score("atom_low_quality", 35), score("atom_high_quality", 96)]
    });

    expect(result.citations.map((citation) => citation.id)).toEqual(["atom_high_quality", "atom_low_quality"]);
    expect(result.rankings[0].factors.quality).toBeGreaterThan(result.rankings[1].factors.quality);
  });
});
