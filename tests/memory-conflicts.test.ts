import { describe, expect, it } from "vitest";
import { createMemoryConflictWorkflow, type MemoryConflictState, type MemoryConflictStore } from "../lib/memory-conflicts";
import type { KnowledgeAtom, Principal } from "../lib/types";

const reviewer: Principal = {
  id: "usr_reviewer",
  name: "Reviewer",
  email: "reviewer@example.com",
  role: "reviewer",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["brain:read", "brain:write"]
};

function createStore(initial?: Partial<MemoryConflictState>) {
  let state: MemoryConflictState | null = initial
    ? {
        conflicts: [],
        auditEvents: [],
        lineageEvents: [],
        ...initial
      }
    : null;

  const store: MemoryConflictStore & { snapshot: () => MemoryConflictState | null } = {
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
    id: "atom_base",
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

describe("memory conflict workflow", () => {
  it("opens duplicate conflicts with compared claim metadata and merge recommendation", async () => {
    const store = createStore();
    const workflow = createMemoryConflictWorkflow({ store, now: () => "2026-06-29T10:00:00.000Z" });
    const existing = atom({
      id: "atom_existing",
      tier: "company-main",
      title: "Company connector review policy",
      body: "Weekly connector review is required for source-backed Composio integrations.",
      freshness: 0.78
    });
    const candidate = atom({
      id: "atom_candidate",
      status: "candidate",
      title: "Connector review policy",
      body: "Weekly connector review is required for source-backed Composio integrations.",
      freshness: 1
    });

    const result = await workflow.detect({ principal: reviewer, candidates: [candidate], existing: [existing] });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      conflictType: "duplicate",
      candidateAtomId: "atom_candidate",
      existingAtomId: "atom_existing",
      recommendedResolution: "merge-duplicate",
      status: "review",
      compared: {
        candidate: {
          sourceIds: ["src_001"],
          tier: "team",
          freshness: 1,
          ownerId: "usr_admin"
        },
        existing: {
          tier: "company-main",
          freshness: 0.78
        }
      }
    });
    expect(result.conflicts[0].changeset.summary).toMatch(/duplicate/i);
  });

  it("opens contradiction conflicts with compared claims and evidence recommendation", async () => {
    const workflow = createMemoryConflictWorkflow({ store: createStore() });
    const existing = atom({
      id: "atom_existing",
      title: "Connector access policy",
      body: "Composio connector access must be approved before use."
    });
    const candidate = atom({
      id: "atom_candidate",
      status: "candidate",
      title: "Connector access policy update",
      body: "Composio connector access must not be approved before use."
    });

    const result = await workflow.detect({ principal: reviewer, candidates: [candidate], existing: [existing] });

    expect(result.conflicts[0]).toMatchObject({
      conflictType: "contradiction",
      recommendedResolution: "request-evidence"
    });
    expect(result.conflicts[0].changeset.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "check_conflict_type",
          status: "warning"
        })
      ])
    );
  });

  it("recommends superseding stale memory with fresh source-backed candidates", async () => {
    const workflow = createMemoryConflictWorkflow({ store: createStore() });
    const existing = atom({
      id: "atom_stale",
      status: "stale",
      title: "Old onboarding workflow",
      body: "Customer onboarding uses a legacy spreadsheet.",
      freshness: 0.18
    });
    const candidate = atom({
      id: "atom_candidate",
      status: "candidate",
      title: "Updated onboarding workflow",
      body: "Customer onboarding uses source-backed Slack handoff artifacts.",
      freshness: 1,
      confidence: 0.86
    });

    const result = await workflow.detect({ principal: reviewer, candidates: [candidate], existing: [existing] });

    expect(result.conflicts[0]).toMatchObject({
      conflictType: "stale-supersession",
      recommendedResolution: "supersede-stale"
    });
  });

  it("records false-positive dismissal with audit and lineage events", async () => {
    const store = createStore();
    const workflow = createMemoryConflictWorkflow({ store, now: () => "2026-06-29T10:00:00.000Z" });
    const detection = await workflow.detect({
      principal: reviewer,
      candidates: [atom({ id: "atom_candidate", status: "candidate" })],
      existing: [atom({ id: "atom_existing" })]
    });

    const resolution = await workflow.resolve({
      conflictId: detection.conflicts[0].id,
      reviewer,
      action: "dismiss-false-positive",
      note: "Same words, different operational scope."
    });

    expect(resolution.conflict.status).toBe("dismissed");
    expect(resolution.auditEvent).toMatchObject({
      action: "review",
      actorId: "usr_reviewer",
      metadata: expect.objectContaining({
        action: "dismiss-false-positive"
      })
    });
    expect(resolution.lineageEvent).toMatchObject({
      relation: "reviewed-by",
      fromId: detection.conflicts[0].id,
      toId: "usr_reviewer"
    });
    expect(store.snapshot()?.auditEvents).toHaveLength(2);
  });

  it("does not expose ACL-restricted conflicts to unauthorized reviewers", async () => {
    const workflow = createMemoryConflictWorkflow({ store: createStore() });
    const restricted = atom({
      id: "atom_restricted",
      tier: "exec-protected",
      title: "Exec hiring plan",
      body: "Exec hiring plan must be approved by the CEO.",
      acl: {
        teams: ["exec"],
        roles: ["admin"],
        sensitivity: "restricted"
      }
    });
    const candidate = atom({
      id: "atom_candidate",
      status: "candidate",
      title: "Exec hiring plan",
      body: "Exec hiring plan must not be approved by the CEO."
    });

    const result = await workflow.detect({ principal: reviewer, candidates: [candidate], existing: [restricted] });

    expect(result.conflicts).toHaveLength(0);
    expect(result.hiddenMatches).toBe(1);
    expect(result.auditEvents[0]).toMatchObject({
      policyDecision: "deny",
      targetId: "atom_restricted"
    });
  });
});
