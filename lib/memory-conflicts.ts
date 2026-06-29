import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canReadAtom } from "./policy";
import type { BrainEvent, Changeset, DependencyEdge, KnowledgeAtom, Principal, ReviewCheck } from "./types";

export type MemoryConflictType = "duplicate" | "contradiction" | "stale-supersession";
export type MemoryConflictStatus = "review" | "resolved" | "dismissed" | "needs-evidence";
export type MemoryConflictResolution =
  | "merge-duplicate"
  | "supersede-stale"
  | "reject-candidate"
  | "request-evidence"
  | "dismiss-false-positive";

type ComparedAtom = {
  atomId: string;
  title: string;
  body: string;
  sourceIds: string[];
  tier: KnowledgeAtom["tier"];
  freshness: number;
  confidence: number;
  ownerId: string;
  status: KnowledgeAtom["status"];
};

export type MemoryConflictRecord = {
  id: string;
  conflictType: MemoryConflictType;
  candidateAtomId: string;
  existingAtomId: string;
  recommendedResolution: Exclude<MemoryConflictResolution, "dismiss-false-positive">;
  status: MemoryConflictStatus;
  compared: {
    candidate: ComparedAtom;
    existing: ComparedAtom;
  };
  changeset: Changeset;
  similarity: number;
  resolution?: {
    action: MemoryConflictResolution;
    reviewerId: string;
    note?: string;
    resolvedAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type MemoryConflictState = {
  conflicts: MemoryConflictRecord[];
  auditEvents: BrainEvent[];
  lineageEvents: DependencyEdge[];
};

export type MemoryConflictStore = {
  read(): Promise<MemoryConflictState | null>;
  write(state: MemoryConflictState): Promise<void>;
};

type WorkflowOptions = {
  store?: MemoryConflictStore;
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

export type DetectMemoryConflictsInput = {
  principal: Principal;
  candidates: KnowledgeAtom[];
  existing: KnowledgeAtom[];
};

export type DetectMemoryConflictsResult = {
  conflicts: MemoryConflictRecord[];
  hiddenMatches: number;
  auditEvents: BrainEvent[];
};

export type ResolveMemoryConflictInput = {
  conflictId: string;
  reviewer: Principal;
  action: MemoryConflictResolution;
  note?: string;
};

function defaultStatePath() {
  return process.env.MEMORY_CONFLICT_STATE_PATH ?? join(process.cwd(), "data", "memory-conflict-state.json");
}

function createFileStore(path = defaultStatePath()): MemoryConflictStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as MemoryConflictState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): MemoryConflictState {
  return {
    conflicts: [],
    auditEvents: [],
    lineageEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function tokens(text: string) {
  return text.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 2) ?? [];
}

function jaccard(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : Number((intersection / union).toFixed(4));
}

function atomTokens(atom: KnowledgeAtom) {
  return tokens([atom.title, atom.body, atom.atomType, ...atom.tags].join(" "));
}

function hasNegatedApproval(text: string) {
  return /\b(must not|should not|do not|not approved|rejected|disabled|forbidden)\b/i.test(text);
}

function hasPositiveApproval(text: string) {
  return /\b(must|should|required|approved|enabled|allowed)\b/i.test(text) && !hasNegatedApproval(text);
}

function contradiction(candidate: KnowledgeAtom, existing: KnowledgeAtom, similarity: number) {
  if (similarity < 0.22) {
    return false;
  }
  const candidateText = `${candidate.title} ${candidate.body}`;
  const existingText = `${existing.title} ${existing.body}`;
  return (hasNegatedApproval(candidateText) && hasPositiveApproval(existingText)) || (hasPositiveApproval(candidateText) && hasNegatedApproval(existingText));
}

function conflictType(candidate: KnowledgeAtom, existing: KnowledgeAtom) {
  const similarity = jaccard(atomTokens(candidate), atomTokens(existing));
  if (contradiction(candidate, existing, similarity)) {
    return { type: "contradiction" as const, similarity };
  }
  if ((existing.status === "stale" || existing.freshness < 0.35) && candidate.freshness > 0.7 && similarity >= 0.18) {
    return { type: "stale-supersession" as const, similarity };
  }
  if (similarity >= 0.5) {
    return { type: "duplicate" as const, similarity };
  }
  return null;
}

function recommendationFor(type: MemoryConflictType): MemoryConflictRecord["recommendedResolution"] {
  if (type === "duplicate") {
    return "merge-duplicate";
  }
  if (type === "stale-supersession") {
    return "supersede-stale";
  }
  return "request-evidence";
}

function compared(atom: KnowledgeAtom): ComparedAtom {
  return {
    atomId: atom.id,
    title: atom.title,
    body: atom.body,
    sourceIds: atom.sourceIds,
    tier: atom.tier,
    freshness: atom.freshness,
    confidence: atom.confidence,
    ownerId: atom.ownerId,
    status: atom.status
  };
}

function checksFor(type: MemoryConflictType, similarity: number): ReviewCheck[] {
  return [
    {
      id: "check_conflict_type",
      label: "Conflict type",
      status: type === "contradiction" ? "warning" : "passed",
      detail: `${type} detected with ${Math.round(similarity * 100)}% token overlap.`
    },
    {
      id: "check_sources",
      label: "Compared source evidence",
      status: "passed",
      detail: "Candidate and existing source ids, tiers, freshness, owners, and confidence are attached."
    }
  ];
}

function createConflictChangeset(input: {
  id: string;
  type: MemoryConflictType;
  candidate: KnowledgeAtom;
  existing: KnowledgeAtom;
  principal: Principal;
  similarity: number;
  now: string;
}): Changeset {
  return {
    id: `${input.id}:changeset`,
    tenantId: input.candidate.tenantId,
    title: `Resolve ${input.type}: ${input.candidate.title}`,
    targetType: "atom",
    targetId: input.candidate.id,
    tier: input.candidate.tier,
    authorId: input.principal.id,
    ownerId: input.candidate.ownerId,
    reviewers: [input.principal.id],
    status: "review",
    summary: `Review ${input.type} between candidate ${input.candidate.id} and existing ${input.existing.id}. Recommended resolution: ${recommendationFor(input.type)}.`,
    checks: checksFor(input.type, input.similarity),
    createdAt: input.now,
    updatedAt: input.now
  };
}

function createAuditEvent(input: {
  id: string;
  tenantId: string;
  actorId: string;
  action: BrainEvent["action"];
  targetId: string;
  targetType: BrainEvent["targetType"];
  policyDecision: BrainEvent["policyDecision"];
  metadata: Record<string, unknown>;
  createdAt: string;
}): BrainEvent {
  return {
    id: input.id,
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: input.action,
    targetId: input.targetId,
    targetType: input.targetType,
    policyDecision: input.policyDecision,
    metadata: input.metadata,
    createdAt: input.createdAt
  };
}

function statusForResolution(action: MemoryConflictResolution): MemoryConflictStatus {
  if (action === "dismiss-false-positive") {
    return "dismissed";
  }
  if (action === "request-evidence") {
    return "needs-evidence";
  }
  return "resolved";
}

export function createMemoryConflictWorkflow(options: WorkflowOptions = {}) {
  const store = options.store ?? createFileStore();
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: MemoryConflictState) {
    await store.write(state);
  }

  return {
    async getState() {
      return load();
    },

    async detect(input: DetectMemoryConflictsInput): Promise<DetectMemoryConflictsResult> {
      const state = await load();
      const createdAt = now();
      const conflicts: MemoryConflictRecord[] = [];
      const auditEvents: BrainEvent[] = [];
      let hiddenMatches = 0;

      for (const candidate of input.candidates) {
        for (const existing of input.existing) {
          if (candidate.id === existing.id) {
            continue;
          }
          const detected = conflictType(candidate, existing);
          if (!detected) {
            continue;
          }

          const existingPolicy = canReadAtom(input.principal, existing);
          if (!existingPolicy.allowed) {
            hiddenMatches += 1;
            auditEvents.push(
              createAuditEvent({
                id: id("evt_conflict_deny"),
                tenantId,
                actorId: input.principal.id,
                action: "query",
                targetId: existing.id,
                targetType: "atom",
                policyDecision: "deny",
                metadata: {
                  reason: existingPolicy.reason,
                  candidateAtomId: candidate.id,
                  conflictType: detected.type
                },
                createdAt
              })
            );
            continue;
          }

          const conflictId = id("mem_conflict");
          const changeset = createConflictChangeset({
            id: conflictId,
            type: detected.type,
            candidate,
            existing,
            principal: input.principal,
            similarity: detected.similarity,
            now: createdAt
          });
          const conflict: MemoryConflictRecord = {
            id: conflictId,
            conflictType: detected.type,
            candidateAtomId: candidate.id,
            existingAtomId: existing.id,
            recommendedResolution: recommendationFor(detected.type),
            status: "review",
            compared: {
              candidate: compared(candidate),
              existing: compared(existing)
            },
            changeset,
            similarity: detected.similarity,
            createdAt,
            updatedAt: createdAt
          };
          conflicts.push(conflict);
          auditEvents.push(
            createAuditEvent({
              id: id("evt_conflict_open"),
              tenantId,
              actorId: input.principal.id,
              action: "changeset.open",
              targetId: conflict.id,
              targetType: "changeset",
              policyDecision: "allow",
              metadata: {
                conflictType: conflict.conflictType,
                candidateAtomId: candidate.id,
                existingAtomId: existing.id,
                recommendedResolution: conflict.recommendedResolution
              },
              createdAt
            })
          );
        }
      }

      state.conflicts = [...conflicts, ...state.conflicts.filter((conflict) => !conflicts.some((next) => next.candidateAtomId === conflict.candidateAtomId && next.existingAtomId === conflict.existingAtomId))];
      state.auditEvents = [...auditEvents, ...state.auditEvents];
      await save(state);

      return { conflicts, hiddenMatches, auditEvents };
    },

    async resolve(input: ResolveMemoryConflictInput) {
      const state = await load();
      const conflict = state.conflicts.find((candidate) => candidate.id === input.conflictId);
      if (!conflict) {
        throw new Error(`Memory conflict ${input.conflictId} was not found.`);
      }

      const resolvedAt = now();
      conflict.status = statusForResolution(input.action);
      conflict.resolution = {
        action: input.action,
        reviewerId: input.reviewer.id,
        note: input.note,
        resolvedAt
      };
      conflict.changeset.status = input.action === "request-evidence" ? "blocked" : input.action === "dismiss-false-positive" ? "rolled-back" : "approved";
      conflict.changeset.updatedAt = resolvedAt;
      conflict.updatedAt = resolvedAt;

      const auditEvent = createAuditEvent({
        id: id("evt_conflict_review"),
        tenantId,
        actorId: input.reviewer.id,
        action: "review",
        targetId: conflict.id,
        targetType: "changeset",
        policyDecision: "allow",
        metadata: {
          action: input.action,
          note: input.note,
          candidateAtomId: conflict.candidateAtomId,
          existingAtomId: conflict.existingAtomId
        },
        createdAt: resolvedAt
      });
      const lineageEvent: DependencyEdge = {
        id: id("edge_conflict_review"),
        fromId: conflict.id,
        toId: input.reviewer.id,
        relation: "reviewed-by"
      };

      state.auditEvents = [auditEvent, ...state.auditEvents];
      state.lineageEvents = [lineageEvent, ...state.lineageEvents];
      await save(state);

      return {
        conflict,
        auditEvent,
        lineageEvent
      };
    }
  };
}

export const memoryConflictWorkflow = createMemoryConflictWorkflow();
