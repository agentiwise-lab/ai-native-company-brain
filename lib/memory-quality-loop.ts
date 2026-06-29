import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrainEvent, KnowledgeAtom, Principal, QualityScore } from "./types";

export type QualityReviewAction = "refresh" | "demote" | "supersede" | "retire";

export type QualityReviewItem = {
  id: string;
  atomId: string;
  score: number;
  status: "open" | "resolved";
  recommendedAction: QualityReviewAction;
  reasons: string[];
  createdAt: string;
  updatedAt: string;
  resolution?: {
    action: QualityReviewAction;
    reviewerId: string;
    note?: string;
    resolvedAt: string;
  };
};

export type MemoryQualityState = {
  scores: QualityScore[];
  queue: QualityReviewItem[];
  auditEvents: BrainEvent[];
};

export type MemoryQualityStore = {
  read(): Promise<MemoryQualityState | null>;
  write(state: MemoryQualityState): Promise<void>;
};

type UsageSignal = {
  retrievals: number;
  successfulAnswers: number;
};

type RunQualityInput = {
  atoms: KnowledgeAtom[];
  sourceHealth?: Record<string, number>;
  usage?: Record<string, UsageSignal>;
  corrections?: Record<string, number>;
  conflicts?: Record<string, number>;
};

type ResolveQualityInput = {
  itemId: string;
  reviewer: Principal;
  action: QualityReviewAction;
  note?: string;
};

type LoopOptions = {
  store?: MemoryQualityStore;
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

function defaultStatePath() {
  return process.env.MEMORY_QUALITY_STATE_PATH ?? join(process.cwd(), "data", "memory-quality-state.json");
}

function createFileStore(path = defaultStatePath()): MemoryQualityStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as MemoryQualityState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): MemoryQualityState {
  return {
    scores: [],
    queue: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function usageScore(signal?: UsageSignal) {
  if (!signal || signal.retrievals === 0) {
    return 50;
  }
  return clamp((signal.successfulAnswers / signal.retrievals) * 100);
}

function scoreAtomSignals(atom: KnowledgeAtom, input: RunQualityInput): QualityScore {
  const sourceHealth = input.sourceHealth?.[atom.id] ?? (atom.sourceIds.length > 0 ? 80 : 35);
  const correctionCount = input.corrections?.[atom.id] ?? 0;
  const conflictCount = input.conflicts?.[atom.id] ?? 0;
  const usage = usageScore(input.usage?.[atom.id]);
  const freshness = clamp(atom.freshness * 100);
  const evidenceStrength = clamp(Math.min(100, atom.sourceIds.length * 28 + sourceHealth * 0.55));
  const specificity = clamp(Math.min(95, atom.body.length / 2));
  const actionability = ["policy", "procedure", "playbook", "decision"].includes(atom.atomType) ? 84 : 66;
  const reviewerTrust = atom.status === "approved" ? 86 : atom.status === "candidate" ? 58 : atom.status === "stale" ? 34 : 20;
  const conflictRisk = clamp(conflictCount * 24 + correctionCount * 10 + (100 - sourceHealth) * 0.18);
  const retractionPenalty = clamp(correctionCount * 8 + (atom.status === "rejected" ? 40 : 0));
  const score = clamp(
    evidenceStrength * 0.2 +
      freshness * 0.18 +
      specificity * 0.1 +
      actionability * 0.1 +
      usage * 0.14 +
      reviewerTrust * 0.18 -
      conflictRisk * 0.12 -
      retractionPenalty * 0.08
  );
  const notes = [
    freshness < 40 ? "Memory is stale." : undefined,
    sourceHealth < 55 ? "Source health is weak." : undefined,
    correctionCount > 0 ? `${correctionCount} correction feedback events.` : undefined,
    conflictCount > 0 ? `${conflictCount} conflict signals.` : undefined,
    score < 75 ? "Quality score is below review threshold." : undefined
  ].filter((note): note is string => Boolean(note));

  return {
    id: `quality_${atom.id}`,
    subjectId: atom.id,
    subjectType: "atom",
    score,
    evidenceStrength,
    freshness,
    specificity,
    actionability,
    conflictRisk,
    reuse: usage,
    reviewerTrust,
    retractionPenalty,
    notes
  };
}

function recommendedAction(score: QualityScore, atom: KnowledgeAtom, corrections: number, conflicts: number): QualityReviewAction {
  if (atom.status === "rejected" || atom.status === "superseded") {
    return "retire";
  }
  if (atom.status === "stale" || score.score < 45) {
    return "demote";
  }
  if (corrections > 0 || score.freshness < 55 || score.evidenceStrength < 60) {
    return "refresh";
  }
  if (conflicts > 1 || score.conflictRisk > 60) {
    return "supersede";
  }
  return "refresh";
}

function shouldQueue(score: QualityScore, atom: KnowledgeAtom) {
  return score.score < 75 || score.freshness < 50 || score.conflictRisk > 35 || atom.status === "stale";
}

export function createMemoryQualityLoop(options: LoopOptions = {}) {
  const store = options.store ?? createFileStore();
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: MemoryQualityState) {
    await store.write(state);
  }

  return {
    async getState() {
      return load();
    },

    async run(input: RunQualityInput) {
      const state = await load();
      const timestamp = now();
      const scores = input.atoms.map((candidate) => scoreAtomSignals(candidate, input));
      const queue: QualityReviewItem[] = [];
      for (const score of scores) {
        const atom = input.atoms.find((candidate) => candidate.id === score.subjectId);
        if (!atom || !shouldQueue(score, atom)) {
          continue;
        }
        const corrections = input.corrections?.[atom.id] ?? 0;
        const conflicts = input.conflicts?.[atom.id] ?? 0;
        queue.push({
          id: id("quality_review"),
          atomId: atom.id,
          score: score.score,
          status: "open",
          recommendedAction: recommendedAction(score, atom, corrections, conflicts),
          reasons: score.notes,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }

      state.scores = [...scores, ...state.scores.filter((score) => !scores.some((next) => next.subjectId === score.subjectId))];
      state.queue = [...queue, ...state.queue.filter((item) => !queue.some((next) => next.atomId === item.atomId))];
      await save(state);
      return { scores, queue };
    },

    async resolve(input: ResolveQualityInput) {
      const state = await load();
      const item = state.queue.find((candidate) => candidate.id === input.itemId);
      if (!item) {
        throw new Error(`Quality review item ${input.itemId} was not found.`);
      }
      const resolvedAt = now();
      item.status = "resolved";
      item.updatedAt = resolvedAt;
      item.resolution = {
        action: input.action,
        reviewerId: input.reviewer.id,
        note: input.note,
        resolvedAt
      };
      const auditEvent: BrainEvent = {
        id: id("evt_quality_review"),
        tenantId,
        actorId: input.reviewer.id,
        action: "review",
        targetId: item.id,
        targetType: "changeset",
        policyDecision: "allow",
        metadata: {
          atomId: item.atomId,
          action: input.action,
          note: input.note,
          score: item.score
        },
        createdAt: resolvedAt
      };
      state.auditEvents = [auditEvent, ...state.auditEvents];
      await save(state);
      return { item, auditEvent };
    }
  };
}

export const memoryQualityLoop = createMemoryQualityLoop();
