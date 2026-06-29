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
import { canDiscoverRegistryItem, canReadAtom, enforceChangesetMerge } from "./policy";
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

function getDemoPrincipal(id = "usr_admin") {
  return principals.find((principal) => principal.id === id) ?? principals[0];
}

function includesText(value: string, query: string) {
  return value.toLowerCase().includes(query.toLowerCase());
}

export const repository = {
  dashboard(): DashboardSnapshot {
    return getDashboardSnapshot();
  },

  principal(id?: string): Principal {
    return getDemoPrincipal(id);
  },

  queryBrain(query: string, principalId?: string, requestedTier?: BrainTier): BrainQueryResult {
    const principal = getDemoPrincipal(principalId);
    const readable = atoms
      .filter((atom) => (requestedTier ? atom.tier === requestedTier : true))
      .map((atom) => ({ atom, policy: canReadAtom(principal, atom) }))
      .filter(({ policy }) => policy.allowed)
      .map(({ atom }) => atom);

    const matches = readable.filter((atom) => {
      if (!query.trim()) {
        return true;
      }

      return includesText(atom.title, query) || includesText(atom.body, query) || atom.tags.some((tag) => includesText(tag, query));
    });

    const citations = matches.length > 0 ? matches : readable.slice(0, 3);
    const retrievedRegistry = registry.filter((item) => canDiscoverRegistryItem(principal, item).allowed).slice(0, 4);
    const event: BrainEvent = {
      id: `evt_query_${Date.now()}`,
      tenantId: "tenant_demo",
      actorId: principal.id,
      action: "query",
      targetId: "brain",
      targetType: "atom",
      policyDecision: "allow",
      metadata: {
        query,
        requestedTier,
        citations: citations.map((atom) => atom.id)
      },
      createdAt: new Date().toISOString()
    };

    return {
      answer:
        citations.length === 0
          ? "No accessible memory matched this query. Open a changeset to add source-backed knowledge before promoting it."
          : `Found ${citations.length} governed memories. Highest authority match: ${citations[0].title}.`,
      citations,
      retrievedRegistry,
      events: [event],
      policy: {
        allowed: true,
        reasons: ["Query results were filtered by tier, role, team, and sensitivity ACLs."]
      }
    };
  },

  commitBrain(input: { title: string; body: string; tier?: BrainTier; principalId?: string }) {
    const principal = getDemoPrincipal(input.principalId);
    const atom: KnowledgeAtom = {
      id: `atom_candidate_${Date.now()}`,
      tenantId: "tenant_demo",
      title: input.title,
      body: input.body,
      atomType: "claim",
      tier: input.tier ?? "team",
      ownerId: principal.id,
      sourceIds: [],
      acl: {
        teams: principal.teams,
        roles: ["admin", "reviewer", "operator", "agent"],
        sensitivity: "internal"
      },
      status: "candidate",
      version: 1,
      confidence: 0.62,
      freshness: 1,
      reviewDueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: ["candidate", "agent-commit"]
    };

    const changeset: Changeset = {
      id: `cs_${Date.now()}`,
      tenantId: "tenant_demo",
      title: `Promote ${input.title}`,
      targetType: "atom",
      targetId: atom.id,
      tier: atom.tier,
      authorId: principal.id,
      ownerId: principal.id,
      reviewers: ["usr_reviewer"],
      status: "review",
      summary: "Agent-created candidate memory awaiting source evidence and owner review.",
      checks: [
        {
          id: "check_owner",
          label: "Owner assigned",
          status: "passed",
          detail: `${principal.name} owns the candidate atom.`
        },
        {
          id: "check_sources",
          label: "Source evidence",
          status: "failed",
          detail: "No source artifacts are attached yet."
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return { atom, changeset };
  },

  lineage(atomId: string) {
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

  searchRegistry(query = "", kind?: RegistryKind, principalId?: string) {
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

  createRegistryChangeset(input: { title: string; targetId: string; principalId?: string }) {
    const principal = getDemoPrincipal(input.principalId);
    const target = registry.find((item) => item.id === input.targetId);

    if (!target) {
      return null;
    }

    const changeset: Changeset = {
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

    return changeset;
  },

  publishRegistryItem(id: string) {
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

  rollbackRegistryItem(id: string) {
    const item = registry.find((candidate) => candidate.id === id);
    return {
      item,
      rolledBack: Boolean(item),
      targetVersion: item && "rollbackTarget" in item ? item.rollbackTarget ?? "previous" : "previous"
    };
  },

  listCronJobs() {
    return registry.filter((item): item is CronJobDefinition => item.kind === "cronjob");
  },

  getCronJob(id: string) {
    return this.listCronJobs().find((job) => job.id === id);
  },

  runCronJob(id: string): { job?: CronJobDefinition; run?: CronRun } {
    const job = this.getCronJob(id);

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

  listCronRuns(id: string) {
    return cronRuns.filter((run) => run.cronJobId === id);
  },

  qualityScores,
  events,
  registry,
  changesets,
  atoms
};
