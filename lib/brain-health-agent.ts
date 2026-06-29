import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MemoryConflictRecord } from "./memory-conflicts";
import type { BrainEvent, BrainTier, Changeset, KnowledgeAtom, Principal, QualityScore } from "./types";

export type BrainHealthAction = "refresh" | "demote" | "supersede" | "assign-owner";
export type BrainHealthRunStatus = "succeeded" | "needs-approval" | "failed";

export type BrainHealthJob = {
  id: string;
  schedule: string;
  timezone: string;
  ownerId: string;
  tier: BrainTier;
  budgetUsd: number;
  outputDestination: string;
  approvalGates: string[];
  enabledAt: string;
  updatedAt: string;
};

export type BrainHealthRecommendation = {
  id: string;
  key: string;
  action: BrainHealthAction;
  affectedAtomId: string;
  reason: string;
  sourceData: string[];
  reviewerId: string;
  policyContext: string;
  createdAt: string;
};

export type BrainHealthRun = {
  id: string;
  status: BrainHealthRunStatus;
  recommendationCount: number;
  changesetCount: number;
  duplicatesSuppressed: number;
  reason?: string;
  approvalId?: string;
  createdAt: string;
};

export type BrainHealthApproval = {
  id: string;
  status: "pending" | "approved" | "rejected";
  reviewerContext: string;
  createdAt: string;
};

export type BrainHealthReport = {
  runId: string;
  outputDestination: string;
  recommendations: Array<{
    affectedAtomId: string;
    action: BrainHealthAction;
    sourceData: string[];
    reviewerId: string;
    policyContext: string;
  }>;
};

export type BrainHealthAgentState = {
  job?: BrainHealthJob;
  runs: BrainHealthRun[];
  recommendations: BrainHealthRecommendation[];
  changesets: Changeset[];
  approvals: BrainHealthApproval[];
  auditEvents: BrainEvent[];
};

export type BrainHealthAgentStore = {
  read(): Promise<BrainHealthAgentState | null>;
  write(state: BrainHealthAgentState): Promise<void>;
};

type AgentOptions = {
  store?: BrainHealthAgentStore;
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

type EnableWeeklyJobInput = {
  ownerId: string;
  tier: BrainTier;
  budgetUsd: number;
  outputDestination: string;
  timezone?: string;
  approvalGates?: string[];
};

export type RunBrainHealthInput = {
  principal: Principal;
  atoms: KnowledgeAtom[];
  qualityScores: QualityScore[];
  conflicts: MemoryConflictRecord[];
  sourceHealth: Record<string, number>;
  failedQueries: Record<string, number>;
};

function defaultStatePath() {
  return process.env.BRAIN_HEALTH_AGENT_STATE_PATH ?? join(process.cwd(), "data", "brain-health-agent-state.json");
}

function createFileStore(path = defaultStatePath()): BrainHealthAgentStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as BrainHealthAgentState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): BrainHealthAgentState {
  return {
    runs: [],
    recommendations: [],
    changesets: [],
    approvals: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function scoreFor(atomId: string, scores: QualityScore[]) {
  return scores.find((score) => score.subjectType === "atom" && score.subjectId === atomId);
}

function healthFor(atom: KnowledgeAtom, sourceHealth: Record<string, number>) {
  const sourceScores = atom.sourceIds.map((sourceId) => sourceHealth[sourceId]).filter((value): value is number => typeof value === "number");
  if (sourceScores.length === 0) {
    return 100;
  }
  return Math.min(...sourceScores);
}

function recommendationKey(action: BrainHealthAction, atomId: string) {
  return `${action}:${atomId}`;
}

function actionTitle(action: BrainHealthAction) {
  return {
    refresh: "Refresh",
    demote: "Demote",
    supersede: "Supersede",
    "assign-owner": "Assign owner"
  }[action];
}

function changeSummary(recommendation: BrainHealthRecommendation) {
  return `${recommendation.action} ${recommendation.affectedAtomId}: ${recommendation.reason}. Source data: ${recommendation.sourceData.join(", ")}. Reviewer ${recommendation.reviewerId}. Policy ${recommendation.policyContext}.`;
}

export function createBrainHealthAgent(options: AgentOptions = {}) {
  const store = options.store ?? createFileStore();
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: BrainHealthAgentState) {
    await store.write(state);
  }

  function makeRecommendation(action: BrainHealthAction, atomId: string, reason: string, sourceData: string[], timestamp: string): BrainHealthRecommendation {
    return {
      id: id("brain_health_recommendation"),
      key: recommendationKey(action, atomId),
      action,
      affectedAtomId: atomId,
      reason,
      sourceData,
      reviewerId: "usr_reviewer",
      policyContext: "brain-health-weekly-policy",
      createdAt: timestamp
    };
  }

  function detect(input: RunBrainHealthInput, timestamp: string) {
    const recommendations: BrainHealthRecommendation[] = [];
    for (const atom of input.atoms) {
      const quality = scoreFor(atom.id, input.qualityScores);
      const sourceHealth = healthFor(atom, input.sourceHealth);
      const failedQueryCount = input.failedQueries[atom.id] ?? 0;
      const sourceData = [...atom.sourceIds, `quality:${quality?.score ?? "missing"}`, `sourceHealth:${sourceHealth}`, `failedQueries:${failedQueryCount}`];

      if (!atom.ownerId) {
        recommendations.push(makeRecommendation("assign-owner", atom.id, "Missing owner blocks accountable curation", sourceData, timestamp));
      }
      if (atom.status === "stale" || atom.freshness < 0.45 || sourceHealth < 50 || failedQueryCount >= 3) {
        recommendations.push(makeRecommendation("refresh", atom.id, "Stale or unhealthy source signals require refresh", sourceData, timestamp));
      }
      if (quality && quality.score < 50) {
        recommendations.push(makeRecommendation("demote", atom.id, "Low quality score requires demotion or rewrite review", sourceData, timestamp));
      }
    }

    for (const conflict of input.conflicts.filter((candidate) => candidate.status === "review")) {
      recommendations.push(
        makeRecommendation(
          "supersede",
          conflict.candidateAtomId,
          `Unresolved ${conflict.conflictType} conflict recommends ${conflict.recommendedResolution}`,
          [conflict.id, conflict.existingAtomId, ...conflict.compared.candidate.sourceIds],
          timestamp
        )
      );
    }

    return recommendations;
  }

  function changesetFor(recommendation: BrainHealthRecommendation, atom: KnowledgeAtom | undefined, principal: Principal, timestamp: string): Changeset {
    return {
      id: id("cs_brain_health"),
      tenantId,
      title: `${actionTitle(recommendation.action)} ${atom?.title ?? recommendation.affectedAtomId}`,
      targetType: "atom",
      targetId: recommendation.affectedAtomId,
      tier: atom?.tier ?? "team",
      authorId: principal.id,
      ownerId: atom?.ownerId || principal.id,
      reviewers: [recommendation.reviewerId],
      status: "review",
      summary: changeSummary(recommendation),
      checks: [
        {
          id: "source_data",
          label: "Source data linked",
          status: recommendation.sourceData.length > 0 ? "passed" : "failed",
          detail: recommendation.sourceData.join(", ")
        },
        {
          id: "policy_context",
          label: "Policy context",
          status: "passed",
          detail: recommendation.policyContext
        }
      ],
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  return {
    async getState() {
      return load();
    },

    async enableWeeklyJob(input: EnableWeeklyJobInput) {
      const state = await load();
      const timestamp = now();
      const job: BrainHealthJob = {
        id: "cron_weekly_brain_health_agent",
        schedule: "0 9 * * MON",
        timezone: input.timezone ?? "UTC",
        ownerId: input.ownerId,
        tier: input.tier,
        budgetUsd: input.budgetUsd,
        outputDestination: input.outputDestination,
        approvalGates: input.approvalGates ?? [],
        enabledAt: state.job?.enabledAt ?? timestamp,
        updatedAt: timestamp
      };
      state.job = job;
      await save(state);
      return job;
    },

    async run(input: RunBrainHealthInput) {
      const state = await load();
      const timestamp = now();
      const job = state.job;
      if (!job) {
        throw new Error("Weekly brain health job is not enabled.");
      }
      if (job.budgetUsd <= 0) {
        const run: BrainHealthRun = {
          id: id("brain_health_run"),
          status: "failed",
          recommendationCount: 0,
          changesetCount: 0,
          duplicatesSuppressed: 0,
          reason: "Brain health budget exhausted.",
          createdAt: timestamp
        };
        state.runs = [run, ...state.runs];
        await save(state);
        return { status: run.status, reason: run.reason, recommendations: [], changesets: [], report: { runId: run.id, outputDestination: job.outputDestination, recommendations: [] }, duplicatesSuppressed: 0 };
      }
      if (job.approvalGates.length > 0) {
        const approval: BrainHealthApproval = {
          id: id("brain_health_approval"),
          status: "pending",
          reviewerContext: `Approval gates required before weekly brain health changesets: ${job.approvalGates.join(", ")}.`,
          createdAt: timestamp
        };
        const run: BrainHealthRun = {
          id: id("brain_health_run"),
          status: "needs-approval",
          recommendationCount: 0,
          changesetCount: 0,
          duplicatesSuppressed: 0,
          approvalId: approval.id,
          createdAt: timestamp
        };
        state.approvals = [approval, ...state.approvals];
        state.runs = [run, ...state.runs];
        await save(state);
        return { status: run.status, approval, recommendations: [], changesets: [], report: { runId: run.id, outputDestination: job.outputDestination, recommendations: [] }, duplicatesSuppressed: 0 };
      }

      const recommendations = detect(input, timestamp);
      const existingOpenKeys = new Set(
        state.recommendations
          .filter((recommendation) => state.changesets.some((changeset) => changeset.targetId === recommendation.affectedAtomId && changeset.status === "review"))
          .map((recommendation) => recommendation.key)
      );
      const freshRecommendations = recommendations.filter((recommendation) => !existingOpenKeys.has(recommendation.key));
      const duplicatesSuppressed = recommendations.length - freshRecommendations.length;
      const changesets = freshRecommendations.map((recommendation) =>
        changesetFor(recommendation, input.atoms.find((atom) => atom.id === recommendation.affectedAtomId), input.principal, timestamp)
      );
      const run: BrainHealthRun = {
        id: id("brain_health_run"),
        status: "succeeded",
        recommendationCount: recommendations.length,
        changesetCount: changesets.length,
        duplicatesSuppressed,
        createdAt: timestamp
      };
      const auditEvent: BrainEvent = {
        id: id("evt_brain_health"),
        tenantId,
        actorId: input.principal.id,
        action: "changeset.open",
        targetId: run.id,
        targetType: "changeset",
        policyDecision: "allow",
        metadata: {
          recommendationCount: recommendations.length,
          changesetCount: changesets.length,
          duplicatesSuppressed
        },
        createdAt: timestamp
      };
      state.recommendations = [...freshRecommendations, ...state.recommendations];
      state.changesets = [...changesets, ...state.changesets];
      state.runs = [run, ...state.runs];
      state.auditEvents = [auditEvent, ...state.auditEvents];
      await save(state);

      const report: BrainHealthReport = {
        runId: run.id,
        outputDestination: job.outputDestination,
        recommendations: recommendations.map((recommendation) => ({
          affectedAtomId: recommendation.affectedAtomId,
          action: recommendation.action,
          sourceData: recommendation.sourceData,
          reviewerId: recommendation.reviewerId,
          policyContext: recommendation.policyContext
        }))
      };
      return { status: run.status, recommendations, changesets, report, duplicatesSuppressed };
    }
  };
}

export const brainHealthAgent = createBrainHealthAgent();
