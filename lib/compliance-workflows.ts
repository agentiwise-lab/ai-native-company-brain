import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { repository as defaultRepository } from "./repository";
import { artifacts as seedArtifacts } from "./seed";
import type { BrainEvent, BrainQueryResult, BrainTier, KnowledgeAtom, Principal, Sensitivity, SourceArtifact } from "./types";
import type { BrainRepository, LineageResult } from "./repository-contract";

export type RetentionDeletionBehavior = "delete" | "tombstone" | "review";

export type RetentionRule = {
  id: string;
  sourceType?: SourceArtifact["sourceType"];
  tier?: BrainTier;
  sensitivity?: Sensitivity;
  retentionDays: number;
  deletionBehavior: RetentionDeletionBehavior;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export type RetentionRuleInput = Omit<RetentionRule, "createdAt" | "updatedAt" | "createdBy">;

export type LegalHold = {
  id: string;
  targetType: "atom" | "artifact" | "source" | "principal";
  targetId: string;
  reason: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  releasedAt?: string;
};

export type RetentionRun = {
  id: string;
  requestedBy: string;
  status: "completed" | "denied";
  evaluatedAtomIds: string[];
  deletedAtomIds: string[];
  tombstonedAtomIds: string[];
  heldAtomIds: string[];
  reviewAtomIds: string[];
  deniedReasons: string[];
  createdAt: string;
};

export type AtomTombstone = {
  id: string;
  atomId: string;
  ruleId: string;
  behavior: RetentionDeletionBehavior;
  reason: "retention_expired";
  createdBy: string;
  createdAt: string;
};

export type MemoryExportRecord = {
  id: string;
  scope: "individual" | "organization";
  requestedBy: string;
  subjectPrincipalId?: string;
  status: "completed" | "denied";
  atomIds: string[];
  sourceIds: string[];
  atoms: KnowledgeAtom[];
  sources: SourceArtifact[];
  lineageByAtom: Record<string, LineageResult>;
  policyContext: {
    scope: "individual" | "organization";
    subjectPrincipalId?: string;
    includeRestricted: boolean;
    retentionRuleIds: string[];
    legalHoldIds: string[];
  };
  deniedReasons: string[];
  createdAt: string;
};

export type AnswerAuditPack = {
  id: string;
  requestedBy: string;
  query: string;
  answer: string;
  retrievedAtomIds: string[];
  sourceIds: string[];
  sources: SourceArtifact[];
  lineageByAtom: Record<string, LineageResult>;
  reviewers: string[];
  policyDecisions: Array<{ allowed: boolean; reasons: string[] }>;
  retrieval: BrainQueryResult["retrieval"];
  queryEvents: BrainEvent[];
  toolEvents: BrainEvent[];
  cronEvents: BrainEvent[];
  sessionIds: string[];
  createdAt: string;
};

export type ComplianceState = {
  retentionRules: RetentionRule[];
  legalHolds: LegalHold[];
  retentionRuns: RetentionRun[];
  memoryExports: MemoryExportRecord[];
  answerAuditPacks: AnswerAuditPack[];
  tombstones: AtomTombstone[];
  auditEvents: BrainEvent[];
};

export type ComplianceStore = {
  read(): Promise<ComplianceState | null>;
  write(state: ComplianceState): Promise<void>;
};

type ConfigureRetentionInput = {
  principal: Principal;
  rules: RetentionRuleInput[];
};

type RunRetentionInput = {
  principal: Principal;
};

type PlaceLegalHoldInput = {
  principal: Principal;
  targetType: LegalHold["targetType"];
  targetId: string;
  reason: string;
};

type ExportMemoryInput = {
  principal: Principal;
  scope: MemoryExportRecord["scope"];
  subjectPrincipalId?: string;
  includeRestricted?: boolean;
};

type BuildAnswerAuditPackInput = {
  principal: Principal;
  query: string;
  requestedTier?: BrainTier;
};

type Options = {
  store?: ComplianceStore;
  repository?: BrainRepository;
  sourceArtifacts?: SourceArtifact[];
  now?: () => string;
  id?: (prefix: string) => string;
  tenantId?: string;
};

function defaultStatePath() {
  return process.env.COMPLIANCE_STATE_PATH ?? join(process.cwd(), "data", "compliance-workflows-state.json");
}

function createFileStore(path = defaultStatePath()): ComplianceStore {
  return {
    async read() {
      if (!existsSync(path)) {
        return null;
      }
      return JSON.parse(await readFile(path, "utf8")) as ComplianceState;
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await rename(tempPath, path);
    }
  };
}

function defaultState(): ComplianceState {
  return {
    retentionRules: [],
    legalHolds: [],
    retentionRuns: [],
    memoryExports: [],
    answerAuditPacks: [],
    tombstones: [],
    auditEvents: []
  };
}

function defaultId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hasAuditAuthority(principal: Principal) {
  return principal.role === "admin" || principal.scopes.includes("audit:read");
}

function requireAdmin(principal: Principal) {
  if (principal.role !== "admin") {
    throw new Error("Compliance configuration requires an admin.");
  }
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function ageDays(atom: KnowledgeAtom, now: string) {
  const basis = Date.parse(atom.updatedAt || atom.createdAt);
  return Math.floor((Date.parse(now) - basis) / 86_400_000);
}

function metadataIncludesAtom(event: BrainEvent, atomIds: string[]) {
  const metadata = event.metadata;
  const values = [metadata.atomId, metadata.targetAtomId, metadata.citationId].filter((value): value is string => typeof value === "string");
  const arrays = [metadata.atomIds, metadata.citations, metadata.citationIds].filter(Array.isArray) as unknown[][];
  return values.some((value) => atomIds.includes(value)) || arrays.some((items) => items.some((item) => typeof item === "string" && atomIds.includes(item)));
}

function sessionIdsFromEvents(events: BrainEvent[]) {
  return unique(
    events.flatMap((event) => {
      const value = event.metadata.sessionId;
      const values = Array.isArray(event.metadata.sessionIds) ? event.metadata.sessionIds : [];
      return [value, ...values].filter((candidate): candidate is string => typeof candidate === "string");
    })
  );
}

export function createComplianceWorkflows(options: Options = {}) {
  const store = options.store ?? createFileStore();
  const repository = options.repository ?? defaultRepository;
  const sourceArtifacts = options.sourceArtifacts ?? seedArtifacts;
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? defaultId;
  const tenantId = options.tenantId ?? process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";

  async function load() {
    return (await store.read()) ?? defaultState();
  }

  async function save(state: ComplianceState) {
    await store.write(state);
  }

  function audit(input: {
    actorId: string;
    action: BrainEvent["action"];
    targetId: string;
    targetType: BrainEvent["targetType"];
    policyDecision: BrainEvent["policyDecision"];
    metadata: Record<string, unknown>;
    createdAt: string;
  }): BrainEvent {
    return {
      id: id("evt_compliance"),
      tenantId,
      actorId: input.actorId,
      action: input.action,
      targetId: input.targetId,
      targetType: input.targetType,
      policyDecision: input.policyDecision,
      metadata: input.metadata,
      createdAt: input.createdAt
    };
  }

  function sourcesForAtom(atom: KnowledgeAtom) {
    return atom.sourceIds.flatMap((sourceId) => {
      const source = sourceArtifacts.find((candidate) => candidate.id === sourceId);
      return source ? [source] : [];
    });
  }

  function ruleMatches(rule: RetentionRule, atom: KnowledgeAtom) {
    const sources = sourcesForAtom(atom);
    if (rule.tier && rule.tier !== atom.tier) {
      return false;
    }
    if (rule.sensitivity && rule.sensitivity !== atom.acl.sensitivity) {
      return false;
    }
    if (rule.sourceType && !sources.some((source) => source.sourceType === rule.sourceType)) {
      return false;
    }
    return true;
  }

  function activeHoldForAtom(state: ComplianceState, atom: KnowledgeAtom) {
    return state.legalHolds.find((hold) => {
      if (!hold.active) {
        return false;
      }
      if (hold.targetType === "atom" && hold.targetId === atom.id) {
        return true;
      }
      if ((hold.targetType === "artifact" || hold.targetType === "source") && atom.sourceIds.includes(hold.targetId)) {
        return true;
      }
      return hold.targetType === "principal" && hold.targetId === atom.ownerId;
    });
  }

  async function lineageForAtoms(atomIds: string[]) {
    const entries = await Promise.all(atomIds.map(async (atomId) => [atomId, await repository.lineage(atomId)] as const));
    return Object.fromEntries(entries);
  }

  function exportSources(atomList: KnowledgeAtom[]) {
    const sourceIds = unique(atomList.flatMap((atom) => atom.sourceIds));
    return {
      sourceIds,
      sources: sourceIds.flatMap((sourceId) => {
        const source = sourceArtifacts.find((candidate) => candidate.id === sourceId);
        return source ? [source] : [];
      })
    };
  }

  return {
    async getState() {
      return load();
    },

    async configureRetention(input: ConfigureRetentionInput) {
      requireAdmin(input.principal);
      const state = await load();
      const timestamp = now();
      const rules: RetentionRule[] = input.rules.map((rule) => ({
        ...rule,
        createdAt: state.retentionRules.find((candidate) => candidate.id === rule.id)?.createdAt ?? timestamp,
        updatedAt: timestamp,
        createdBy: input.principal.id
      }));
      state.retentionRules = rules;
      const event = audit({
        actorId: input.principal.id,
        action: "retention.configure",
        targetId: "retention",
        targetType: "retention-policy",
        policyDecision: "allow",
        metadata: { ruleIds: rules.map((rule) => rule.id), ruleCount: rules.length },
        createdAt: timestamp
      });
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { state, auditEvent: event };
    },

    async placeLegalHold(input: PlaceLegalHoldInput) {
      requireAdmin(input.principal);
      const state = await load();
      const timestamp = now();
      const hold: LegalHold = {
        id: id("legal_hold"),
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        active: true,
        createdBy: input.principal.id,
        createdAt: timestamp
      };
      const event = audit({
        actorId: input.principal.id,
        action: "legal-hold.apply",
        targetId: hold.id,
        targetType: "legal-hold",
        policyDecision: "allow",
        metadata: { targetType: hold.targetType, targetId: hold.targetId, reason: hold.reason },
        createdAt: timestamp
      });
      state.legalHolds = [hold, ...state.legalHolds];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { hold, auditEvent: event };
    },

    async runRetention(input: RunRetentionInput) {
      const state = await load();
      const timestamp = now();
      const deniedReasons = hasAuditAuthority(input.principal) ? [] : ["audit:read scope or admin role is required for retention runs."];
      const snapshot = await repository.dashboard();
      const run: RetentionRun = {
        id: id("retention_run"),
        requestedBy: input.principal.id,
        status: deniedReasons.length > 0 ? "denied" : "completed",
        evaluatedAtomIds: [],
        deletedAtomIds: [],
        tombstonedAtomIds: [],
        heldAtomIds: [],
        reviewAtomIds: [],
        deniedReasons,
        createdAt: timestamp
      };
      const tombstones: AtomTombstone[] = [];

      if (deniedReasons.length === 0) {
        for (const atom of snapshot.atoms) {
          const rule = state.retentionRules.find((candidate) => ruleMatches(candidate, atom) && ageDays(atom, timestamp) >= candidate.retentionDays);
          if (!rule) {
            continue;
          }
          run.evaluatedAtomIds.push(atom.id);
          if (activeHoldForAtom(state, atom)) {
            run.heldAtomIds.push(atom.id);
            continue;
          }
          if (rule.deletionBehavior === "review") {
            run.reviewAtomIds.push(atom.id);
            continue;
          }
          if (rule.deletionBehavior === "delete") {
            run.deletedAtomIds.push(atom.id);
          }
          if (rule.deletionBehavior === "tombstone") {
            run.tombstonedAtomIds.push(atom.id);
          }
          tombstones.push({
            id: id("atom_tombstone"),
            atomId: atom.id,
            ruleId: rule.id,
            behavior: rule.deletionBehavior,
            reason: "retention_expired",
            createdBy: input.principal.id,
            createdAt: timestamp
          });
        }
      }

      const event = audit({
        actorId: input.principal.id,
        action: "retention.run",
        targetId: run.id,
        targetType: "retention-policy",
        policyDecision: run.status === "denied" ? "deny" : "allow",
        metadata: {
          evaluatedAtomIds: run.evaluatedAtomIds,
          deletedAtomIds: run.deletedAtomIds,
          tombstonedAtomIds: run.tombstonedAtomIds,
          heldAtomIds: run.heldAtomIds,
          reviewAtomIds: run.reviewAtomIds,
          deniedReasons
        },
        createdAt: timestamp
      });
      state.retentionRuns = [run, ...state.retentionRuns];
      state.tombstones = [...tombstones, ...state.tombstones.filter((tombstone) => !tombstones.some((next) => next.atomId === tombstone.atomId))];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { run, tombstones, auditEvents: [event] };
    },

    async exportMemory(input: ExportMemoryInput) {
      const state = await load();
      const timestamp = now();
      const includeRestricted = input.includeRestricted ?? false;
      const deniedReasons: string[] = [];

      if (input.scope === "organization" && !hasAuditAuthority(input.principal)) {
        deniedReasons.push("Organization export requires audit:read scope or admin role.");
      }
      if (input.scope === "individual" && input.subjectPrincipalId !== input.principal.id && !hasAuditAuthority(input.principal)) {
        deniedReasons.push("Individual export for another principal requires audit:read scope or admin role.");
      }

      const snapshot = await repository.dashboard();
      const selectedAtoms = input.scope === "individual"
        ? snapshot.atoms.filter((atom) => atom.ownerId === (input.subjectPrincipalId ?? input.principal.id))
        : snapshot.atoms;
      const deniedSensitive = selectedAtoms.filter((atom) => atom.acl.sensitivity === "restricted" && !(input.principal.role === "admin" && includeRestricted));
      if (deniedSensitive.length > 0) {
        deniedReasons.push(`Denied by restricted sensitivity policy: ${deniedSensitive.map((atom) => atom.id).join(",")}.`);
      }

      const allowedAtoms = deniedReasons.length > 0 ? [] : selectedAtoms;
      const atomIds = allowedAtoms.map((atom) => atom.id);
      const { sourceIds, sources } = exportSources(allowedAtoms);
      const record: MemoryExportRecord = {
        id: id("memory_export"),
        scope: input.scope,
        requestedBy: input.principal.id,
        subjectPrincipalId: input.subjectPrincipalId,
        status: deniedReasons.length > 0 ? "denied" : "completed",
        atomIds,
        sourceIds,
        atoms: allowedAtoms,
        sources,
        lineageByAtom: deniedReasons.length > 0 ? {} : await lineageForAtoms(atomIds),
        policyContext: {
          scope: input.scope,
          subjectPrincipalId: input.subjectPrincipalId,
          includeRestricted,
          retentionRuleIds: state.retentionRules.map((rule) => rule.id),
          legalHoldIds: state.legalHolds.filter((hold) => hold.active).map((hold) => hold.id)
        },
        deniedReasons,
        createdAt: timestamp
      };
      const event = audit({
        actorId: input.principal.id,
        action: "export",
        targetId: record.id,
        targetType: "export",
        policyDecision: record.status === "denied" ? "deny" : "allow",
        metadata: {
          scope: record.scope,
          subjectPrincipalId: record.subjectPrincipalId,
          atomIds: record.atomIds,
          sourceIds: record.sourceIds,
          deniedReasons
        },
        createdAt: timestamp
      });
      state.memoryExports = [record, ...state.memoryExports];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { record, auditEvent: event };
    },

    async buildAnswerAuditPack(input: BuildAnswerAuditPackInput) {
      if (!hasAuditAuthority(input.principal)) {
        throw new Error("Answer audit pack requires audit:read scope or admin role.");
      }
      const state = await load();
      const timestamp = now();
      const result = await repository.queryBrain(input.query, input.principal.id, input.requestedTier);
      const atomIds = result.citations.map((atom) => atom.id);
      const { sourceIds, sources } = exportSources(result.citations);
      const lineageByAtom = await lineageForAtoms(atomIds);
      const lineageEvents = Object.values(lineageByAtom).flatMap((lineage) => lineage.events);
      const reviewers = unique(lineageEvents.filter((event) => event.action === "review").map((event) => event.actorId));
      const allEvents = await repository.allEvents();
      const toolEvents = allEvents.filter((event) => event.action === "tool.invoke" && metadataIncludesAtom(event, atomIds));
      const cronEvents = allEvents.filter((event) => event.action === "cron.run" && metadataIncludesAtom(event, atomIds));
      const pack: AnswerAuditPack = {
        id: id("answer_audit_pack"),
        requestedBy: input.principal.id,
        query: input.query,
        answer: result.answer,
        retrievedAtomIds: atomIds,
        sourceIds,
        sources,
        lineageByAtom,
        reviewers,
        policyDecisions: [result.policy],
        retrieval: result.retrieval,
        queryEvents: result.events,
        toolEvents,
        cronEvents,
        sessionIds: sessionIdsFromEvents([...toolEvents, ...cronEvents, ...result.events]),
        createdAt: timestamp
      };
      const event = audit({
        actorId: input.principal.id,
        action: "answer.audit-pack",
        targetId: pack.id,
        targetType: "answer-audit-pack",
        policyDecision: "allow",
        metadata: { query: input.query, atomIds, sourceIds, toolEventIds: toolEvents.map((item) => item.id), cronEventIds: cronEvents.map((item) => item.id) },
        createdAt: timestamp
      });
      state.answerAuditPacks = [pack, ...state.answerAuditPacks];
      state.auditEvents = [event, ...state.auditEvents];
      await save(state);
      return { pack, auditEvent: event };
    }
  };
}

export const complianceWorkflows = createComplianceWorkflows();
