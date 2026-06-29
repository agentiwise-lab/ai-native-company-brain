import { describe, expect, it } from "vitest";
import { scoreAtom, scoreCronRuns, scoreRegistryItem, summarizeQuality } from "../lib/quality";
import type { Changeset, CronRun, KnowledgeAtom, QualityScore, SkillPackage } from "../lib/types";

const atomBase: KnowledgeAtom = {
  id: "atom_quality",
  tenantId: "tenant_test",
  title: "Reviewed memory",
  body: "Reviewed memory is more trustworthy than candidate memory.",
  atomType: "claim",
  tier: "team",
  ownerId: "usr_owner",
  sourceIds: ["source_1", "source_2"],
  acl: {
    teams: [],
    roles: ["admin", "reviewer", "employee", "operator", "agent"],
    sensitivity: "internal"
  },
  status: "approved",
  version: 1,
  confidence: 0.9,
  freshness: 0.9,
  reviewDueAt: "2026-07-01T00:00:00.000Z",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  tags: []
};

const skill: SkillPackage = {
  id: "skill_quality",
  tenantId: "tenant_test",
  kind: "skill",
  name: "Quality Skill",
  slug: "quality-skill",
  description: "A governed skill.",
  tier: "team",
  ownerId: "usr_owner",
  version: "1.0.0",
  status: "published",
  permissions: ["brain:read"],
  dependencies: ["policy_quality"],
  requiredTools: [],
  adapterTargets: ["codex", "generic-mcp"],
  updatedAt: "2026-06-01T00:00:00.000Z",
  skillMarkdown: "# Quality Skill",
  evals: ["quality-eval"],
  examples: ["Use reviewed sources."],
  changelog: ["Initial version."]
};

describe("quality scoring", () => {
  it("scores approved source-backed atoms higher than stale or rejected atoms", () => {
    const approved = scoreAtom(atomBase);
    const stale = scoreAtom({ ...atomBase, status: "stale", confidence: 0.3, freshness: 0.1 });

    expect(approved).toBeGreaterThan(stale);
    expect(approved).toBeLessThanOrEqual(100);
    expect(stale).toBeGreaterThanOrEqual(0);
  });

  it("penalizes blocked registry changesets for the same package", () => {
    const blockedChangeset: Changeset = {
      id: "cs_blocked",
      tenantId: "tenant_test",
      title: "Blocked update",
      targetType: "skill",
      targetId: skill.id,
      tier: "team",
      authorId: "usr_owner",
      ownerId: "usr_owner",
      reviewers: ["usr_reviewer"],
      status: "blocked",
      summary: "Blocked by missing evals.",
      checks: [],
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z"
    };

    expect(scoreRegistryItem(skill, [blockedChangeset])).toBeLessThan(scoreRegistryItem(skill, []));
  });

  it("scores cron run quality from success, approval, and failure outcomes", () => {
    const runs: CronRun[] = [
      {
        id: "run_1",
        cronJobId: "cron_1",
        status: "succeeded",
        startedAt: "2026-06-01T00:00:00.000Z",
        finishedAt: "2026-06-01T00:01:00.000Z",
        durationMs: 60_000,
        output: "Done",
        auditEventIds: []
      },
      {
        id: "run_2",
        cronJobId: "cron_1",
        status: "failed",
        startedAt: "2026-06-02T00:00:00.000Z",
        finishedAt: "2026-06-02T00:01:00.000Z",
        durationMs: 60_000,
        output: "Failed",
        auditEventIds: []
      }
    ];

    expect(scoreCronRuns(runs)).toBe(30);
    expect(scoreCronRuns([])).toBe(0);
  });

  it("summarizes quality risk and extrema", () => {
    const scores: QualityScore[] = [
      {
        id: "score_1",
        subjectId: "atom_1",
        subjectType: "atom",
        score: 90,
        evidenceStrength: 90,
        freshness: 90,
        specificity: 80,
        actionability: 80,
        conflictRisk: 5,
        reuse: 10,
        reviewerTrust: 90,
        retractionPenalty: 0,
        notes: []
      },
      {
        id: "score_2",
        subjectId: "atom_2",
        subjectType: "atom",
        score: 60,
        evidenceStrength: 40,
        freshness: 30,
        specificity: 70,
        actionability: 60,
        conflictRisk: 45,
        reuse: 3,
        reviewerTrust: 50,
        retractionPenalty: 5,
        notes: ["Needs review."]
      }
    ];

    expect(summarizeQuality(scores)).toMatchObject({
      average: 75,
      riskCount: 1,
      highest: scores[0],
      lowest: scores[1]
    });
  });
});
