import {
  atoms,
  changesets,
  cronRuns,
  edges,
  events,
  getDashboardSnapshot,
  principals,
  qualityScores,
  registry
} from "./seed";
import { rankHybridAtoms } from "./hybrid-retrieval";
import { canDiscoverRegistryItem, canReviewChangeset, enforceChangesetMerge } from "./policy";
import type {
  BrainEvent,
  BrainQueryResult,
  BrainTier,
  Changeset,
  CronJobDefinition,
  CronRun,
  DashboardSnapshot,
  KnowledgeAtom,
  Principal,
  RegistryItem,
  RegistryKind
} from "./types";
import type {
  BrainRepository,
  CommitBrainInput,
  CreateRegistryChangesetInput,
  CronRunResult,
  LineageResult,
  MergeMemoryChangesetInput,
  MergeMemoryChangesetResult,
  RegistryPublishResult,
  RegistryRollbackResult,
  ReviewMemoryChangesetInput,
  ReviewMemoryChangesetResult
} from "./repository-contract";

function getDemoPrincipal(id = "usr_admin") {
  const principal = principals.find((candidate) => candidate.id === id);
  if (!principal) {
    throw new Error(`Principal ${id} was not found.`);
  }
  return principal;
}

function includesText(value: string, query: string) {
  return value.toLowerCase().includes(query.toLowerCase());
}

function seedId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createCandidateAtom(input: CommitBrainInput, principal: Principal): KnowledgeAtom {
  const createdAt = new Date().toISOString();

  return {
    id: seedId("atom_candidate"),
    tenantId: "tenant_demo",
    title: input.title,
    body: input.body,
    atomType: input.atomType ?? "claim",
    tier: input.tier ?? "team",
    ownerId: input.ownerId ?? principal.id,
    sourceIds: input.sourceIds ?? [],
    acl: input.acl ?? {
      teams: principal.teams,
      roles: ["admin", "reviewer", "operator", "agent"],
      sensitivity: "internal"
    },
    status: "candidate",
    version: 1,
    confidence: input.confidence ?? 0.62,
    freshness: input.freshness ?? 1,
    reviewDueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt,
    updatedAt: createdAt,
    tags: input.tags ?? (input.sourceUri ? ["candidate", "agent-commit", "source-linked"] : ["candidate", "agent-commit"])
  };
}

function createAtomChangeset(atom: KnowledgeAtom, principal: Principal, input: CommitBrainInput): Changeset {
  const createdAt = new Date().toISOString();
  const hasSourceEvidence = atom.sourceIds.length > 0 || atom.tags.includes("source-linked");

  return {
    id: seedId("cs"),
    tenantId: atom.tenantId,
    title: `Promote ${atom.title}`,
    targetType: "atom",
    targetId: atom.id,
    tier: atom.tier,
    authorId: principal.id,
    ownerId: atom.ownerId,
    reviewers: input.reviewers ?? ["usr_reviewer"],
    status: input.changesetStatus ?? "review",
    summary: input.changesetSummary ?? "Agent-created candidate memory awaiting source evidence and owner review.",
    checks: [
      {
        id: "check_owner",
        label: "Owner assigned",
        status: "passed",
        detail: `${atom.ownerId} owns the candidate atom.`
      },
      {
        id: "check_sources",
        label: "Source evidence",
        status: hasSourceEvidence ? "passed" : "failed",
        detail: hasSourceEvidence ? "Source evidence is attached." : "No source artifacts are attached yet."
      },
      ...(input.reviewChecks ?? [])
    ],
    createdAt,
    updatedAt: createdAt
  };
}

export function createSeedRepository(): BrainRepository {
  return {
    async dashboard(): Promise<DashboardSnapshot> {
      return getDashboardSnapshot();
    },

    async principal(id?: string): Promise<Principal> {
      return getDemoPrincipal(id);
    },

    async queryBrain(query: string, principalId?: string, requestedTier?: BrainTier): Promise<BrainQueryResult> {
      const principal = getDemoPrincipal(principalId);
      const retrieval = rankHybridAtoms({
        query,
        principal,
        atoms,
        edges,
        qualityScores,
        requestedTier,
        limit: query.trim() ? 5 : 3
      });
      const citations = retrieval.citations;
      const retrievedRegistry = registry.filter((item) => canDiscoverRegistryItem(principal, item).allowed).slice(0, 4);
      const event: BrainEvent = {
        id: seedId("evt_query"),
        tenantId: "tenant_demo",
        actorId: principal.id,
        action: "query",
        targetId: "brain",
        targetType: "atom",
        policyDecision: "allow",
        metadata: {
          query,
          requestedTier,
          citations: citations.map((atom) => atom.id),
          rankings: retrieval.rankings,
          denied: retrieval.denied.map((candidate) => candidate.atom.id)
        },
        createdAt: new Date().toISOString()
      };
      const denyEvents: BrainEvent[] = retrieval.denied
        .map(({ atom, policy, score, factors }) => ({
          id: seedId("evt_policy_deny"),
          tenantId: atom.tenantId,
          actorId: principal.id,
          action: "query",
          targetId: atom.id,
          targetType: "atom",
          policyDecision: "deny",
          metadata: {
            query,
            requestedTier,
            reason: policy.reason,
            score,
            factors
          },
          createdAt: new Date().toISOString()
        }));
      events.unshift(event, ...denyEvents);

      return {
        answer: citations.length === 0
          ? `${retrieval.explanation} Open a changeset to add source-backed knowledge before promoting it.`
          : `${retrieval.explanation} Highest authority match: ${citations[0].title}.`,
        citations,
        retrievedRegistry,
        events: [event, ...denyEvents],
        retrieval: {
          explanation: retrieval.explanation,
          rankings: retrieval.rankings,
          denied: retrieval.denied.map((candidate) => ({
            atomId: candidate.atom.id,
            reason: candidate.policy.reason,
            score: candidate.score
          }))
        },
        policy: {
          allowed: true,
          reasons: ["Query results were ranked by lexical, vector, graph, freshness, confidence, and tier authority, then filtered by ACL."]
        }
      };
    },

    async commitBrain(input: CommitBrainInput) {
      const principal = getDemoPrincipal(input.principalId);
      const atom = createCandidateAtom(input, principal);
      const changeset = createAtomChangeset(atom, principal, input);
      const event: BrainEvent = {
        id: seedId("evt_changeset"),
        tenantId: atom.tenantId,
        actorId: principal.id,
        action: "changeset.open",
        targetId: changeset.id,
        targetType: "changeset",
        policyDecision: "allow",
        metadata: {
          atomId: atom.id,
          sourceIds: atom.sourceIds,
          sourceUri: input.sourceUri,
          sourceTitle: input.sourceTitle,
          atomType: atom.atomType,
          ownerId: atom.ownerId,
          confidence: atom.confidence
        },
        createdAt: new Date().toISOString()
      };

      atoms.unshift(atom);
      changesets.unshift(changeset);
      events.unshift(event);

      return { atom, changeset, event };
    },

    async lineage(atomId: string): Promise<LineageResult> {
      const atom = atoms.find((candidate) => candidate.id === atomId);
      const relatedEdges = edges.filter((edge) => edge.fromId === atomId || edge.toId === atomId);
      const sourceEvents = events.filter((event) => event.targetId === atomId);
      return {
        atom,
        edges: relatedEdges,
        events: sourceEvents,
        sources: atom ? atom.sourceIds : []
      };
    },

    async listChangesets(targetType?: "atom" | RegistryKind): Promise<Changeset[]> {
      return changesets.filter((changeset) => (targetType ? changeset.targetType === targetType : true));
    },

    async reviewMemoryChangeset(input: ReviewMemoryChangesetInput): Promise<ReviewMemoryChangesetResult> {
      const reviewer = getDemoPrincipal(input.reviewerId);
      const changeset = changesets.find((candidate) => candidate.id === input.changesetId);

      if (!changeset || changeset.targetType !== "atom") {
        throw new Error(`Memory changeset ${input.changesetId} was not found.`);
      }

      const reviewPolicy = canReviewChangeset(reviewer, changeset);
      if (!reviewPolicy.allowed) {
        throw new Error(reviewPolicy.reason);
      }

      const atom = atoms.find((candidate) => candidate.id === changeset.targetId);
      if (atom) {
        atom.updatedAt = new Date().toISOString();
        if (input.editedTitle) {
          atom.title = input.editedTitle;
        }
        if (input.editedBody) {
          atom.body = input.editedBody;
        }
      }

      if (input.action === "approve") {
        changeset.status = "approved";
      }
      if (input.action === "reject") {
        changeset.status = "rolled-back";
        if (atom) {
          atom.status = "rejected";
        }
      }
      if (input.action === "request-changes") {
        changeset.status = "blocked";
      }

      changeset.updatedAt = new Date().toISOString();
      const event: BrainEvent = {
        id: seedId("evt_review"),
        tenantId: changeset.tenantId,
        actorId: reviewer.id,
        action: "review",
        targetId: changeset.targetId,
        targetType: "atom",
        policyDecision: "allow",
        metadata: {
          changesetId: changeset.id,
          reviewAction: input.action,
          note: input.note,
          edited: Boolean(input.editedTitle || input.editedBody)
        },
        createdAt: new Date().toISOString()
      };
      events.unshift(event);

      return { atom, changeset, event };
    },

    async mergeMemoryChangeset(input: MergeMemoryChangesetInput): Promise<MergeMemoryChangesetResult> {
      const reviewer = getDemoPrincipal(input.reviewerId);
      const changeset = changesets.find((candidate) => candidate.id === input.changesetId);

      if (!changeset || changeset.targetType !== "atom") {
        return {
          events: [],
          decision: {
            allowed: false,
            reasons: [`Memory changeset ${input.changesetId} was not found.`]
          }
        };
      }

      const reviewPolicy = canReviewChangeset(reviewer, changeset);
      if (!reviewPolicy.allowed) {
        return {
          changeset,
          events: [],
          decision: {
            allowed: false,
            reasons: [reviewPolicy.reason]
          }
        };
      }

      const atom = atoms.find((candidate) => candidate.id === changeset.targetId);
      const checkDecision = enforceChangesetMerge(changeset.checks);
      const approvalDecision =
        changeset.status === "approved"
          ? { allowed: true, reasons: ["Changeset is approved."] }
          : { allowed: false, reasons: ["Changeset must be approved before merge."] };
      const decision = checkDecision.allowed && approvalDecision.allowed
        ? { allowed: true, reasons: ["All required checks passed."] }
        : {
            allowed: false,
            reasons: [...checkDecision.reasons.filter((reason) => reason !== "All required checks passed."), ...approvalDecision.reasons.filter((reason) => reason !== "Changeset is approved.")]
          };

      if (!decision.allowed || !atom) {
        return { atom, changeset, events: [], decision };
      }

      atom.status = "approved";
      atom.tier = input.targetTier ?? changeset.tier;
      atom.version += 1;
      atom.updatedAt = new Date().toISOString();
      changeset.status = "merged";
      changeset.updatedAt = atom.updatedAt;

      const mergeEvent: BrainEvent = {
        id: seedId("evt_merge"),
        tenantId: changeset.tenantId,
        actorId: reviewer.id,
        action: "merge",
        targetId: atom.id,
        targetType: "atom",
        policyDecision: "allow",
        metadata: {
          changesetId: changeset.id,
          targetTier: atom.tier
        },
        createdAt: new Date().toISOString()
      };
      events.unshift(mergeEvent);
      const reviewEvent = events.find((event) => event.targetId === atom.id && event.action === "review");

      return {
        atom,
        changeset,
        events: reviewEvent ? [reviewEvent, mergeEvent] : [mergeEvent],
        decision
      };
    },

    async searchRegistry(query = "", kind?: RegistryKind, principalId?: string): Promise<RegistryItem[]> {
      const principal = getDemoPrincipal(principalId);
      return registry.filter((item) => {
        const policy = canDiscoverRegistryItem(principal, item);
        const kindMatch = kind ? item.kind === kind : true;
        const queryMatch =
          !query.trim() ||
          includesText(item.name, query) ||
          includesText(item.description, query) ||
          includesText(item.slug, query);
        return policy.allowed && kindMatch && queryMatch;
      });
    },

    async createRegistryChangeset(input: CreateRegistryChangesetInput): Promise<Changeset | null> {
      const principal = getDemoPrincipal(input.principalId);
      const target = registry.find((item) => item.id === input.targetId);

      if (!target) {
        return null;
      }

      return {
        id: `cs_registry_${Date.now()}`,
        tenantId: "tenant_demo",
        title: input.title,
        targetType: target.kind,
        targetId: target.id,
        tier: target.tier,
        authorId: principal.id,
        ownerId: target.ownerId,
        reviewers: ["usr_reviewer"],
        status: "review",
        summary: `Proposed update for ${target.name}.`,
        checks: [
          {
            id: "check_owner",
            label: "Owner assigned",
            status: target.ownerId ? "passed" : "failed",
            detail: target.ownerId ? "Owner is configured." : "Missing owner."
          },
          {
            id: "check_adapters",
            label: "Adapter generation",
            status: target.adapterTargets.length > 0 ? "passed" : "failed",
            detail: `${target.adapterTargets.length} adapter targets configured.`
          },
          {
            id: "check_permissions",
            label: "Permission review",
            status: target.permissions.some((permission) => permission.includes("write")) ? "warning" : "passed",
            detail: "Permission set was evaluated against registry policy."
          }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    },

    async publishRegistryItem(id: string): Promise<RegistryPublishResult> {
      const item = registry.find((candidate) => candidate.id === id);
      const relatedChangeset = changesets.find((changeset) => changeset.targetId === id);
      const mergeDecision = relatedChangeset
        ? enforceChangesetMerge(relatedChangeset.checks)
        : {
            allowed: false,
            reasons: ["No reviewed changeset exists for this registry item."]
          };

      return {
        item,
        published: Boolean(item && mergeDecision.allowed),
        decision: mergeDecision
      };
    },

    async rollbackRegistryItem(id: string): Promise<RegistryRollbackResult> {
      const item = registry.find((candidate) => candidate.id === id);
      return {
        item,
        rolledBack: Boolean(item),
        targetVersion: item && "rollbackTarget" in item ? item.rollbackTarget ?? "previous" : "previous"
      };
    },

    async listCronJobs(): Promise<CronJobDefinition[]> {
      return registry.filter((item): item is CronJobDefinition => item.kind === "cronjob");
    },

    async getCronJob(id: string): Promise<CronJobDefinition | undefined> {
      const jobs = await this.listCronJobs();
      return jobs.find((job) => job.id === id);
    },

    async runCronJob(id: string): Promise<CronRunResult> {
      const job = await this.getCronJob(id);

      if (!job) {
        return {};
      }

      const run: CronRun = {
        id: `run_${Date.now()}`,
        cronJobId: job.id,
        status: job.approvalGates.length > 0 ? "needs-approval" : "succeeded",
        startedAt: new Date().toISOString(),
        finishedAt: job.approvalGates.length > 0 ? undefined : new Date().toISOString(),
        durationMs: job.approvalGates.length > 0 ? undefined : 1200,
        output:
          job.approvalGates.length > 0
            ? `Run paused at approval gates: ${job.approvalGates.join(", ")}.`
            : `Ran ${job.name} with ${job.allowedTools.length} allowed tools.`,
        auditEventIds: [`evt_cron_${Date.now()}`]
      };

      return { job, run };
    },

    async listCronRuns(id: string): Promise<CronRun[]> {
      return cronRuns.filter((run) => run.cronJobId === id);
    },

    async allRegistry(): Promise<RegistryItem[]> {
      return registry;
    },

    async allEvents(): Promise<BrainEvent[]> {
      return events;
    }
  };
}
