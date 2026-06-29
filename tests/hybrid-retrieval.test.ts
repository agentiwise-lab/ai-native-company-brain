import { describe, expect, it } from "vitest";
import { rankHybridAtoms } from "../lib/hybrid-retrieval";
import type { DependencyEdge, KnowledgeAtom, Principal } from "../lib/types";

const reviewer: Principal = {
  id: "usr_reviewer",
  name: "Reviewer",
  email: "reviewer@example.com",
  role: "reviewer",
  teams: ["platform"],
  tiers: ["individual", "team", "department", "company-main"],
  scopes: ["brain:read"]
};

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

describe("hybrid retrieval ranking", () => {
  it("prefers higher-authority company-main memory over a team atom for the same question", () => {
    const team = atom({
      id: "atom_team",
      tier: "team",
      title: "Connector review policy",
      body: "Weekly connector review is required for Composio integrations.",
      freshness: 1,
      confidence: 0.88
    });
    const company = atom({
      id: "atom_company",
      tier: "company-main",
      title: "Company connector review policy",
      body: "All Composio connector integrations require weekly source-backed review.",
      freshness: 0.72,
      confidence: 0.82
    });

    const result = rankHybridAtoms({
      query: "connector review policy",
      principal: reviewer,
      atoms: [team, company]
    });

    expect(result.citations.map((citation) => citation.id)).toEqual(["atom_company", "atom_team"]);
    expect(result.rankings[0]).toMatchObject({
      atomId: "atom_company",
      factors: expect.objectContaining({
        tierAuthority: expect.any(Number),
        lexical: expect.any(Number),
        vector: expect.any(Number)
      })
    });
  });

  it("demotes stale memory below fresher relevant memory while keeping both visible", () => {
    const staleCompany = atom({
      id: "atom_stale_company",
      tier: "company-main",
      title: "Old onboarding policy",
      body: "Customer onboarding requires a legacy spreadsheet review.",
      status: "stale",
      freshness: 0.12,
      confidence: 0.5,
      tags: ["onboarding", "legacy"]
    });
    const freshTeam = atom({
      id: "atom_fresh_team",
      tier: "team",
      title: "Updated onboarding workflow",
      body: "Customer onboarding now uses source-backed Slack handoff artifacts.",
      status: "candidate",
      freshness: 1,
      confidence: 0.72,
      tags: ["onboarding", "slack", "source-linked"]
    });

    const result = rankHybridAtoms({
      query: "customer onboarding workflow",
      principal: reviewer,
      atoms: [staleCompany, freshTeam]
    });

    expect(result.citations.map((citation) => citation.id)).toEqual(["atom_fresh_team", "atom_stale_company"]);
    expect(result.explanation).toMatch(/freshness|tier authority/i);
  });

  it("excludes restricted matches from citations and reports denied candidates", () => {
    const restricted = atom({
      id: "atom_exec",
      tier: "exec-protected",
      title: "Exec hiring plan",
      body: "Exec hiring plan includes restricted compensation guidance.",
      acl: {
        teams: ["exec"],
        roles: ["admin"],
        sensitivity: "restricted"
      }
    });
    const accessible = atom({
      id: "atom_public",
      title: "Hiring review policy",
      body: "Hiring review policy requires source-backed approvals.",
      tier: "company-main"
    });

    const result = rankHybridAtoms({
      query: "hiring policy",
      principal: reviewer,
      atoms: [restricted, accessible]
    });

    expect(result.citations.map((citation) => citation.id)).toEqual(["atom_public"]);
    expect(result.denied.map((candidate) => candidate.atom.id)).toEqual(["atom_exec"]);
    expect(result.denied[0].policy.reason).toMatch(/exec-protected|role|team/i);
  });

  it("returns no citations for a no-match query", () => {
    const result = rankHybridAtoms({
      query: "nonexistent astrophysics budget",
      principal: reviewer,
      atoms: [atom()]
    });

    expect(result.citations).toHaveLength(0);
    expect(result.rankings).toHaveLength(0);
    expect(result.explanation).toMatch(/no accessible memory/i);
  });

  it("returns mixed-source answers with graph and metadata ranking factors", () => {
    const policy = atom({
      id: "atom_policy",
      tier: "company-main",
      title: "Source-backed promotion policy",
      body: "Company memory promotion requires source evidence, owner review, and merge checks.",
      tags: ["promotion", "source-linked", "policy"]
    });
    const playbook = atom({
      id: "atom_playbook",
      tier: "team",
      title: "Promotion review playbook",
      body: "Reviewers inspect source snippets before approving memory changesets.",
      atomType: "playbook",
      tags: ["promotion", "review", "snippets"]
    });
    const edges: DependencyEdge[] = [
      {
        id: "edge_source",
        fromId: "atom_playbook",
        toId: "atom_policy",
        relation: "depends-on"
      }
    ];

    const result = rankHybridAtoms({
      query: "source-backed promotion review",
      principal: reviewer,
      atoms: [playbook, policy],
      edges
    });

    expect(result.citations.map((citation) => citation.id)).toEqual(["atom_policy", "atom_playbook"]);
    expect(result.rankings.every((ranking) => ranking.factors.lexical > 0)).toBe(true);
    expect(result.rankings.some((ranking) => ranking.factors.graph > 0)).toBe(true);
    expect(result.explanation).toContain("2 citations");
  });
});
