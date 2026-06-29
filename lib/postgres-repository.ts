import { Pool, type PoolClient } from "pg";
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
  DependencyEdge,
  KnowledgeAtom,
  Principal,
  QualityScore,
  RegistryItem,
  RegistryKind,
  ReviewCheck
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

export type SqlClient = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

type ReleasableSqlClient = SqlClient & {
  release?: () => void;
};

type PoolLike = SqlClient & {
  connect?: () => Promise<PoolClient>;
};

type PostgresRepositoryOptions = {
  client?: PoolLike;
  connectionString?: string;
  tenantId?: string;
  now?: () => string;
  id?: (prefix: string) => string;
};

type Row = Record<string, unknown>;

function includesText(value: string, query: string) {
  return value.toLowerCase().includes(query.toLowerCase());
}

function value<T>(row: Row, camelKey: string, snakeKey: string): T {
  return (row[camelKey] ?? row[snakeKey]) as T;
}

function list<T = string>(input: unknown): T[] {
  return Array.isArray(input) ? (input as T[]) : [];
}

function object(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function iso(input: unknown) {
  if (input instanceof Date) {
    return input.toISOString();
  }

  if (typeof input === "string") {
    return input;
  }

  return new Date().toISOString();
}

function number(input: unknown) {
  return typeof input === "number" ? input : Number(input ?? 0);
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toPrincipal(row: Row): Principal {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: value<Principal["role"]>(row, "role", "role"),
    teams: list<string>(row.teams),
    tiers: list<BrainTier>(row.tiers),
    scopes: list<string>(row.scopes)
  };
}

function toAtom(row: Row): KnowledgeAtom {
  return {
    id: String(row.id),
    tenantId: value<string>(row, "tenantId", "tenant_id"),
    title: String(row.title),
    body: String(row.body),
    atomType: value<KnowledgeAtom["atomType"]>(row, "atomType", "atom_type"),
    tier: value<BrainTier>(row, "tier", "tier"),
    ownerId: value<string>(row, "ownerId", "owner_id"),
    sourceIds: list<string>(value(row, "sourceIds", "source_ids")),
    acl: value<KnowledgeAtom["acl"]>(row, "acl", "acl"),
    status: value<KnowledgeAtom["status"]>(row, "status", "status"),
    version: number(row.version),
    confidence: number(row.confidence),
    freshness: number(row.freshness),
    reviewDueAt: iso(value(row, "reviewDueAt", "review_due_at")),
    createdAt: iso(value(row, "createdAt", "created_at")),
    updatedAt: iso(value(row, "updatedAt", "updated_at")),
    tags: list<string>(row.tags)
  };
}

function toChangeset(row: Row): Changeset {
  return {
    id: String(row.id),
    tenantId: value<string>(row, "tenantId", "tenant_id"),
    title: String(row.title),
    targetType: value<Changeset["targetType"]>(row, "targetType", "target_type"),
    targetId: value<string>(row, "targetId", "target_id"),
    tier: value<BrainTier>(row, "tier", "tier"),
    authorId: value<string>(row, "authorId", "author_id"),
    ownerId: value<string>(row, "ownerId", "owner_id"),
    reviewers: list<string>(row.reviewers),
    status: value<Changeset["status"]>(row, "status", "status"),
    summary: String(row.summary),
    checks: list<ReviewCheck>(row.checks),
    createdAt: iso(value(row, "createdAt", "created_at")),
    updatedAt: iso(value(row, "updatedAt", "updated_at"))
  };
}

function toRegistryItem(row: Row): RegistryItem {
  const manifest = object(row.manifest);
  const base = {
    id: String(row.id),
    tenantId: value<string>(row, "tenantId", "tenant_id"),
    kind: value<RegistryKind>(row, "kind", "kind"),
    name: String(row.name),
    slug: String(row.slug),
    description: String(row.description),
    tier: value<BrainTier>(row, "tier", "tier"),
    ownerId: value<string>(row, "ownerId", "owner_id"),
    version: String(row.version),
    status: value<RegistryItem["status"]>(row, "status", "status"),
    permissions: list<string>(row.permissions),
    dependencies: list<string>(row.dependencies),
    requiredTools: list<string>(value(row, "requiredTools", "required_tools")),
    adapterTargets: list<RegistryItem["adapterTargets"][number]>(value(row, "adapterTargets", "adapter_targets")),
    updatedAt: iso(value(row, "updatedAt", "updated_at"))
  };

  return { ...base, ...manifest } as RegistryItem;
}

function toCronRun(row: Row): CronRun {
  return {
    id: String(row.id),
    cronJobId: value<string>(row, "cronJobId", "cron_job_id"),
    status: value<CronRun["status"]>(row, "status", "status"),
    startedAt: iso(value(row, "startedAt", "started_at")),
    finishedAt: row.finishedAt || row.finished_at ? iso(value(row, "finishedAt", "finished_at")) : undefined,
    durationMs: row.durationMs || row.duration_ms ? number(value(row, "durationMs", "duration_ms")) : undefined,
    output: String(row.output ?? ""),
    auditEventIds: list<string>(value(row, "auditEventIds", "audit_event_ids"))
  };
}

function toQualityScore(row: Row): QualityScore {
  const dimensions = object(row.dimensions);
  return {
    id: String(row.id),
    subjectId: value<string>(row, "subjectId", "subject_id"),
    subjectType: value<QualityScore["subjectType"]>(row, "subjectType", "subject_type"),
    score: number(row.score),
    evidenceStrength: number(row.evidenceStrength ?? dimensions.evidenceStrength),
    freshness: number(row.freshness ?? dimensions.freshness),
    specificity: number(row.specificity ?? dimensions.specificity),
    actionability: number(row.actionability ?? dimensions.actionability),
    conflictRisk: number(row.conflictRisk ?? dimensions.conflictRisk),
    reuse: number(row.reuse ?? dimensions.reuse),
    reviewerTrust: number(row.reviewerTrust ?? dimensions.reviewerTrust),
    retractionPenalty: number(row.retractionPenalty ?? dimensions.retractionPenalty),
    notes: list<string>(row.notes)
  };
}

function toEvent(row: Row): BrainEvent {
  return {
    id: String(row.id),
    tenantId: value<string>(row, "tenantId", "tenant_id"),
    actorId: value<string>(row, "actorId", "actor_id"),
    action: value<BrainEvent["action"]>(row, "action", "action"),
    targetId: value<string>(row, "targetId", "target_id"),
    targetType: value<BrainEvent["targetType"]>(row, "targetType", "target_type"),
    policyDecision: value<BrainEvent["policyDecision"]>(row, "policyDecision", "policy_decision"),
    metadata: object(row.metadata),
    createdAt: iso(value(row, "createdAt", "created_at"))
  };
}

function toEdge(row: Row): DependencyEdge {
  return {
    id: String(row.id),
    fromId: value<string>(row, "fromId", "from_id"),
    toId: value<string>(row, "toId", "to_id"),
    relation: value<DependencyEdge["relation"]>(row, "relation", "relation")
  };
}

function createCandidateAtom(input: CommitBrainInput, principal: Principal, tenantId: string, now: string, id: (prefix: string) => string): KnowledgeAtom {
  return {
    id: id("atom_candidate"),
    tenantId,
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
    reviewDueAt: new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now,
    updatedAt: now,
    tags: input.tags ?? (input.sourceUri ? ["candidate", "agent-commit", "source-linked"] : ["candidate", "agent-commit"])
  };
}

function createAtomChangeset(atom: KnowledgeAtom, principal: Principal, input: CommitBrainInput, now: string, id: (prefix: string) => string): Changeset {
  const hasSourceEvidence = atom.sourceIds.length > 0 || atom.tags.includes("source-linked");

  return {
    id: id("cs"),
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
    createdAt: now,
    updatedAt: now
  };
}

function createEvent(input: Omit<BrainEvent, "id" | "createdAt" | "tenantId">, tenantId: string, now: string, id: (prefix: string) => string): BrainEvent {
  return {
    id: id("evt"),
    tenantId,
    createdAt: now,
    ...input
  };
}

async function insertAtom(client: SqlClient, atom: KnowledgeAtom) {
  await client.query(
    `INSERT INTO knowledge_atoms (
      id, tenant_id, title, body, atom_type, tier, owner_id, source_ids, acl, status, version,
      confidence, freshness, review_due_at, tags, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      atom.id,
      atom.tenantId,
      atom.title,
      atom.body,
      atom.atomType,
      atom.tier,
      atom.ownerId,
      atom.sourceIds,
      JSON.stringify(atom.acl),
      atom.status,
      atom.version,
      atom.confidence,
      atom.freshness,
      atom.reviewDueAt,
      atom.tags,
      atom.createdAt,
      atom.updatedAt
    ]
  );
}

async function insertChangeset(client: SqlClient, changeset: Changeset) {
  await client.query(
    `INSERT INTO changesets (
      id, tenant_id, title, target_type, target_id, tier, author_id, owner_id, reviewers,
      status, summary, checks, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)`,
    [
      changeset.id,
      changeset.tenantId,
      changeset.title,
      changeset.targetType,
      changeset.targetId,
      changeset.tier,
      changeset.authorId,
      changeset.ownerId,
      changeset.reviewers,
      changeset.status,
      changeset.summary,
      JSON.stringify(changeset.checks),
      changeset.createdAt,
      changeset.updatedAt
    ]
  );
}

async function insertEvent(client: SqlClient, event: BrainEvent) {
  await client.query(
    `INSERT INTO brain_events (
      id, tenant_id, actor_id, action, target_id, target_type, policy_decision, metadata, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      event.id,
      event.tenantId,
      event.actorId,
      event.action,
      event.targetId,
      event.targetType,
      event.policyDecision,
      JSON.stringify(event.metadata),
      event.createdAt
    ]
  );
}

async function insertCronRun(client: SqlClient, tenantId: string, run: CronRun) {
  await client.query(
    `INSERT INTO cron_runs (
      id, tenant_id, cron_job_id, status, started_at, finished_at, duration_ms, output, audit_event_ids
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      run.id,
      tenantId,
      run.cronJobId,
      run.status,
      run.startedAt,
      run.finishedAt ?? null,
      run.durationMs ?? null,
      run.output,
      run.auditEventIds
    ]
  );
}

export function createPostgresRepository(options: PostgresRepositoryOptions = {}): BrainRepository {
  const tenantId = options.tenantId ?? "tenant_demo";
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? makeId;
  const client: PoolLike =
    options.client ??
    new Pool({
      connectionString: options.connectionString
    });

  async function transaction<T>(operation: (tx: SqlClient) => Promise<T>) {
    let tx: ReleasableSqlClient = client;
    let release = false;

    if (typeof client.connect === "function") {
      tx = await client.connect();
      release = true;
    }

    await tx.query("BEGIN");
    try {
      const result = await operation(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      await tx.query("ROLLBACK");
      throw error;
    } finally {
      if (release) {
        tx.release?.();
      }
    }
  }

  async function selectPrincipal(sqlClient: SqlClient, principalId?: string): Promise<Principal> {
    const result = principalId
      ? await sqlClient.query<Row>(
          `SELECT id, name, email, role, teams, tiers, scopes
           FROM principals
           WHERE tenant_id = $1 AND id = $2
           LIMIT 1`,
          [tenantId, principalId]
        )
      : await sqlClient.query<Row>(
          `SELECT id, name, email, role, teams, tiers, scopes
           FROM principals
           WHERE tenant_id = $1
           ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, created_at ASC
           LIMIT 1`,
          [tenantId]
        );

    if (!result.rows[0]) {
      throw new Error(`No principal found for tenant ${tenantId}. Run npm run db:seed or bootstrap the tenant first.`);
    }

    return toPrincipal(result.rows[0]);
  }

  async function selectRegistryById(sqlClient: SqlClient, itemId: string) {
    const result = await sqlClient.query<Row>(
      `SELECT *
       FROM registry_items
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [tenantId, itemId]
    );
    return result.rows[0] ? toRegistryItem(result.rows[0]) : undefined;
  }

  async function selectChangesetById(sqlClient: SqlClient, changesetId: string) {
    const result = await sqlClient.query<Row>(
      `SELECT *
       FROM changesets
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [tenantId, changesetId]
    );
    return result.rows[0] ? toChangeset(result.rows[0]) : undefined;
  }

  async function selectAtomById(sqlClient: SqlClient, atomId: string) {
    const result = await sqlClient.query<Row>(
      `SELECT *
       FROM knowledge_atoms
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [tenantId, atomId]
    );
    return result.rows[0] ? toAtom(result.rows[0]) : undefined;
  }

  async function selectLatestChangeset(sqlClient: SqlClient, itemId: string) {
    const result = await sqlClient.query<Row>(
      `SELECT *
       FROM changesets
       WHERE tenant_id = $1 AND target_id = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [tenantId, itemId]
    );
    return result.rows[0] ? toChangeset(result.rows[0]) : undefined;
  }

  return {
    async dashboard(): Promise<DashboardSnapshot> {
      const principal = await selectPrincipal(client);
      const [atomRows, registryRows, changesetRows, cronRows, scoreRows, eventRows] = await Promise.all([
        client.query<Row>(`SELECT * FROM knowledge_atoms WHERE tenant_id = $1 ORDER BY updated_at DESC`, [tenantId]),
        client.query<Row>(`SELECT * FROM registry_items WHERE tenant_id = $1 ORDER BY updated_at DESC`, [tenantId]),
        client.query<Row>(`SELECT * FROM changesets WHERE tenant_id = $1 ORDER BY updated_at DESC`, [tenantId]),
        client.query<Row>(`SELECT * FROM cron_runs WHERE tenant_id = $1 ORDER BY started_at DESC`, [tenantId]),
        client.query<Row>(`SELECT * FROM quality_scores WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]),
        client.query<Row>(`SELECT * FROM brain_events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100`, [tenantId])
      ]);
      const atoms = atomRows.rows.map(toAtom);
      const registry = registryRows.rows.map(toRegistryItem);
      const changesets = changesetRows.rows.map(toChangeset);

      return {
        principal,
        tiers: principal.tiers.map((tier) => ({
          tier,
          atomCount: atoms.filter((atom) => atom.tier === tier).length,
          registryCount: registry.filter((item) => item.tier === tier).length,
          staleCount: atoms.filter((atom) => atom.tier === tier && atom.status === "stale").length,
          openChangesets: changesets.filter((changeset) => changeset.tier === tier && !["merged", "rolled-back"].includes(changeset.status)).length
        })),
        atoms,
        registry,
        changesets,
        cronRuns: cronRows.rows.map(toCronRun),
        qualityScores: scoreRows.rows.map(toQualityScore),
        events: eventRows.rows.map(toEvent)
      };
    },

    async principal(principalId?: string): Promise<Principal> {
      return selectPrincipal(client, principalId);
    },

    async queryBrain(query: string, principalId?: string, requestedTier?: BrainTier): Promise<BrainQueryResult> {
      const principal = await selectPrincipal(client, principalId);
      const atomResult = requestedTier
        ? await client.query<Row>(
            `SELECT *
             FROM knowledge_atoms
             WHERE tenant_id = $1 AND tier = $2
             ORDER BY updated_at DESC`,
            [tenantId, requestedTier]
          )
        : await client.query<Row>(
            `SELECT *
             FROM knowledge_atoms
             WHERE tenant_id = $1
             ORDER BY updated_at DESC`,
            [tenantId]
          );
      const registryResult = await client.query<Row>(
        `SELECT *
         FROM registry_items
         WHERE tenant_id = $1
         ORDER BY updated_at DESC`,
        [tenantId]
      );
      const edgeResult = await client.query<Row>(
        `SELECT *
         FROM dependency_edges
         WHERE tenant_id = $1`,
        [tenantId]
      );
      const retrieval = rankHybridAtoms({
        query,
        principal,
        atoms: atomResult.rows.map(toAtom),
        edges: edgeResult.rows.map(toEdge),
        requestedTier,
        limit: query.trim() ? 5 : 3
      });
      const citations = retrieval.citations;
      const retrievedRegistry = registryResult.rows
        .map(toRegistryItem)
        .filter((item) => canDiscoverRegistryItem(principal, item).allowed)
        .slice(0, 4);
      const event = createEvent(
        {
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
          }
        },
        tenantId,
        now(),
        id
      );
      const denyEvents: BrainEvent[] = retrieval.denied
        .map(({ atom, policy, score, factors }) =>
          createEvent(
            {
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
              }
            },
            tenantId,
            now(),
            id
          )
        );
      await insertEvent(client, event);
      for (const denyEvent of denyEvents) {
        await insertEvent(client, denyEvent);
      }

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
      return transaction(async (tx) => {
        const principal = await selectPrincipal(tx, input.principalId);
        const timestamp = now();
        const atom = createCandidateAtom(input, principal, tenantId, timestamp, id);
        const changeset = createAtomChangeset(atom, principal, input, timestamp, id);
        const event = createEvent(
          {
            actorId: principal.id,
            action: "changeset.open",
            targetId: changeset.id,
            targetType: "changeset",
            policyDecision: "allow",
            metadata: {
              atomId: atom.id,
              targetType: changeset.targetType,
              sourceIds: atom.sourceIds,
              sourceUri: input.sourceUri,
              sourceTitle: input.sourceTitle,
              atomType: atom.atomType,
              ownerId: atom.ownerId,
              confidence: atom.confidence
            }
          },
          tenantId,
          timestamp,
          id
        );

        await insertAtom(tx, atom);
        await insertChangeset(tx, changeset);
        await insertEvent(tx, event);

        return { atom, changeset, event };
      });
    },

    async lineage(atomId: string): Promise<LineageResult> {
      const [atomResult, edgeResult, eventResult] = await Promise.all([
        client.query<Row>(`SELECT * FROM knowledge_atoms WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, atomId]),
        client.query<Row>(`SELECT * FROM dependency_edges WHERE tenant_id = $1 AND (from_id = $2 OR to_id = $2)`, [tenantId, atomId]),
        client.query<Row>(`SELECT * FROM brain_events WHERE tenant_id = $1 AND target_id = $2 ORDER BY created_at DESC`, [tenantId, atomId])
      ]);
      const atom = atomResult.rows[0] ? toAtom(atomResult.rows[0]) : undefined;

      return {
        atom,
        edges: edgeResult.rows.map(toEdge),
        events: eventResult.rows.map(toEvent),
        sources: atom ? atom.sourceIds : []
      };
    },

    async listChangesets(targetType?: "atom" | RegistryKind): Promise<Changeset[]> {
      const result = targetType
        ? await client.query<Row>(
            `SELECT *
             FROM changesets
             WHERE tenant_id = $1 AND target_type = $2
             ORDER BY updated_at DESC`,
            [tenantId, targetType]
          )
        : await client.query<Row>(
            `SELECT *
             FROM changesets
             WHERE tenant_id = $1
             ORDER BY updated_at DESC`,
            [tenantId]
          );
      return result.rows.map(toChangeset);
    },

    async reviewMemoryChangeset(input: ReviewMemoryChangesetInput): Promise<ReviewMemoryChangesetResult> {
      return transaction(async (tx) => {
        const reviewer = await selectPrincipal(tx, input.reviewerId);
        const changeset = await selectChangesetById(tx, input.changesetId);

        if (!changeset || changeset.targetType !== "atom") {
          throw new Error(`Memory changeset ${input.changesetId} was not found.`);
        }

        const reviewPolicy = canReviewChangeset(reviewer, changeset);
        if (!reviewPolicy.allowed) {
          throw new Error(reviewPolicy.reason);
        }

        const atom = await selectAtomById(tx, changeset.targetId);
        const timestamp = now();
        let nextChangesetStatus: Changeset["status"] = changeset.status;
        let nextAtomStatus = atom?.status;

        if (input.action === "approve") {
          nextChangesetStatus = "approved";
        }
        if (input.action === "reject") {
          nextChangesetStatus = "rolled-back";
          nextAtomStatus = "rejected";
        }
        if (input.action === "request-changes") {
          nextChangesetStatus = "blocked";
        }

        if (atom) {
          await tx.query(
            `UPDATE knowledge_atoms
             SET title = $3, body = $4, status = $5, updated_at = $6
             WHERE tenant_id = $1 AND id = $2`,
            [
              tenantId,
              atom.id,
              input.editedTitle ?? atom.title,
              input.editedBody ?? atom.body,
              nextAtomStatus ?? atom.status,
              timestamp
            ]
          );
        }

        await tx.query(
          `UPDATE changesets
           SET status = $3, updated_at = $4
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, changeset.id, nextChangesetStatus, timestamp]
        );

        const updatedAtom = atom
          ? {
              ...atom,
              title: input.editedTitle ?? atom.title,
              body: input.editedBody ?? atom.body,
              status: nextAtomStatus ?? atom.status,
              updatedAt: timestamp
            }
          : undefined;
        const updatedChangeset = { ...changeset, status: nextChangesetStatus, updatedAt: timestamp };
        const event = createEvent(
          {
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
            }
          },
          tenantId,
          timestamp,
          id
        );

        await insertEvent(tx, event);
        return { atom: updatedAtom, changeset: updatedChangeset, event };
      });
    },

    async mergeMemoryChangeset(input: MergeMemoryChangesetInput): Promise<MergeMemoryChangesetResult> {
      const changeset = await selectChangesetById(client, input.changesetId);

      if (!changeset || changeset.targetType !== "atom") {
        return {
          events: [],
          decision: {
            allowed: false,
            reasons: [`Memory changeset ${input.changesetId} was not found.`]
          }
        };
      }

      const atom = await selectAtomById(client, changeset.targetId);
      const reviewer = await selectPrincipal(client, input.reviewerId);
      const reviewPolicy = canReviewChangeset(reviewer, changeset);
      if (!reviewPolicy.allowed) {
        return {
          atom,
          changeset,
          events: [],
          decision: {
            allowed: false,
            reasons: [reviewPolicy.reason]
          }
        };
      }
      const checkDecision = enforceChangesetMerge(changeset.checks);
      const approvalDecision =
        changeset.status === "approved"
          ? { allowed: true, reasons: ["Changeset is approved."] }
          : { allowed: false, reasons: ["Changeset must be approved before merge."] };
      const decision =
        checkDecision.allowed && approvalDecision.allowed
          ? { allowed: true, reasons: ["All required checks passed."] }
          : {
              allowed: false,
              reasons: [
                ...checkDecision.reasons.filter((reason) => reason !== "All required checks passed."),
                ...approvalDecision.reasons.filter((reason) => reason !== "Changeset is approved.")
              ]
            };

      if (!decision.allowed || !atom) {
        return { atom, changeset, events: [], decision };
      }

      return transaction(async (tx) => {
        const timestamp = now();
        const updatedAtom: KnowledgeAtom = {
          ...atom,
          status: "approved",
          tier: input.targetTier ?? changeset.tier,
          version: atom.version + 1,
          updatedAt: timestamp
        };
        const updatedChangeset: Changeset = {
          ...changeset,
          status: "merged",
          updatedAt: timestamp
        };

        await tx.query(
          `UPDATE knowledge_atoms
           SET status = 'approved', tier = $3, version = version + 1, updated_at = $4
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, atom.id, updatedAtom.tier, timestamp]
        );
        await tx.query(
          `UPDATE changesets
           SET status = 'merged', updated_at = $3
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, changeset.id, timestamp]
        );

        const mergeEvent = createEvent(
          {
            actorId: reviewer.id,
            action: "merge",
            targetId: atom.id,
            targetType: "atom",
            policyDecision: "allow",
            metadata: {
              changesetId: changeset.id,
              targetTier: updatedAtom.tier
            }
          },
          tenantId,
          timestamp,
          id
        );
        await insertEvent(tx, mergeEvent);

        const reviewEventResult = await tx.query<Row>(
          `SELECT *
           FROM brain_events
           WHERE tenant_id = $1 AND target_id = $2 AND action = 'review'
           ORDER BY created_at DESC
           LIMIT 1`,
          [tenantId, atom.id]
        );
        const reviewEvent = reviewEventResult.rows[0] ? toEvent(reviewEventResult.rows[0]) : undefined;

        return {
          atom: updatedAtom,
          changeset: updatedChangeset,
          events: reviewEvent ? [reviewEvent, mergeEvent] : [mergeEvent],
          decision
        };
      });
    },

    async searchRegistry(query = "", kind?: RegistryKind, principalId?: string): Promise<RegistryItem[]> {
      const principal = await selectPrincipal(client, principalId);
      const result = kind
        ? await client.query<Row>(
            `SELECT *
             FROM registry_items
             WHERE tenant_id = $1 AND kind = $2
             ORDER BY updated_at DESC`,
            [tenantId, kind]
          )
        : await client.query<Row>(
            `SELECT *
             FROM registry_items
             WHERE tenant_id = $1
             ORDER BY updated_at DESC`,
            [tenantId]
          );

      return result.rows
        .map(toRegistryItem)
        .filter((item) => {
          const policy = canDiscoverRegistryItem(principal, item);
          const queryMatch =
            !query.trim() ||
            includesText(item.name, query) ||
            includesText(item.description, query) ||
            includesText(item.slug, query);
          return policy.allowed && queryMatch;
        });
    },

    async createRegistryChangeset(input: CreateRegistryChangesetInput): Promise<Changeset | null> {
      const target = await selectRegistryById(client, input.targetId);

      if (!target) {
        return null;
      }

      return transaction(async (tx) => {
        const principal = await selectPrincipal(tx, input.principalId);
        const timestamp = now();
        const changeset: Changeset = {
          id: id("cs_registry"),
          tenantId,
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
          createdAt: timestamp,
          updatedAt: timestamp
        };
        const event = createEvent(
          {
            actorId: principal.id,
            action: "changeset.open",
            targetId: changeset.id,
            targetType: "changeset",
            policyDecision: "allow",
            metadata: {
              registryItemId: target.id,
              registryKind: target.kind
            }
          },
          tenantId,
          timestamp,
          id
        );

        await insertChangeset(tx, changeset);
        await insertEvent(tx, event);
        return changeset;
      });
    },

    async publishRegistryItem(itemId: string): Promise<RegistryPublishResult> {
      const item = await selectRegistryById(client, itemId);

      if (!item) {
        return {
          item,
          published: false,
          decision: { allowed: false, reasons: ["Registry item not found."] }
        };
      }

      const relatedChangeset = await selectLatestChangeset(client, itemId);
      const mergeDecision = relatedChangeset
        ? enforceChangesetMerge(relatedChangeset.checks)
        : {
            allowed: false,
            reasons: ["No reviewed changeset exists for this registry item."]
          };

      if (!mergeDecision.allowed) {
        return { item, published: false, decision: mergeDecision };
      }

      const publishedItem = await transaction(async (tx) => {
        const timestamp = now();
        await tx.query(`UPDATE registry_items SET status = 'published', updated_at = $3 WHERE tenant_id = $1 AND id = $2`, [
          tenantId,
          itemId,
          timestamp
        ]);
        await insertEvent(
          tx,
          createEvent(
            {
              actorId: relatedChangeset?.ownerId ?? item.ownerId,
              action: "registry.publish",
              targetId: itemId,
              targetType: item.kind,
              policyDecision: "allow",
              metadata: {
                changesetId: relatedChangeset?.id
              }
            },
            tenantId,
            timestamp,
            id
          )
        );
        return { ...item, status: "published" as const, updatedAt: timestamp };
      });

      return { item: publishedItem, published: true, decision: mergeDecision };
    },

    async rollbackRegistryItem(itemId: string): Promise<RegistryRollbackResult> {
      const item = await selectRegistryById(client, itemId);

      if (!item) {
        return { item, rolledBack: false };
      }

      const targetVersion = "rollbackTarget" in item ? item.rollbackTarget ?? "previous" : "previous";
      const rolledBackItem = await transaction(async (tx) => {
        const timestamp = now();
        await tx.query(`UPDATE registry_items SET status = 'deprecated', updated_at = $3 WHERE tenant_id = $1 AND id = $2`, [
          tenantId,
          itemId,
          timestamp
        ]);
        await insertEvent(
          tx,
          createEvent(
            {
              actorId: item.ownerId,
              action: "rollback",
              targetId: itemId,
              targetType: item.kind,
              policyDecision: "allow",
              metadata: { targetVersion }
            },
            tenantId,
            timestamp,
            id
          )
        );
        return { ...item, status: "deprecated" as const, updatedAt: timestamp };
      });

      return {
        item: rolledBackItem,
        rolledBack: true,
        targetVersion
      };
    },

    async listCronJobs(): Promise<CronJobDefinition[]> {
      const result = await client.query<Row>(
        `SELECT *
         FROM registry_items
         WHERE tenant_id = $1 AND kind = 'cronjob'
         ORDER BY updated_at DESC`,
        [tenantId]
      );
      return result.rows.map(toRegistryItem).filter((item): item is CronJobDefinition => item.kind === "cronjob");
    },

    async getCronJob(jobId: string): Promise<CronJobDefinition | undefined> {
      const item = await selectRegistryById(client, jobId);
      return item?.kind === "cronjob" ? item : undefined;
    },

    async runCronJob(jobId: string): Promise<CronRunResult> {
      const job = await this.getCronJob(jobId);

      if (!job) {
        return {};
      }

      return transaction(async (tx) => {
        const timestamp = now();
        const eventId = id("evt_cron");
        const run: CronRun = {
          id: id("run"),
          cronJobId: job.id,
          status: job.approvalGates.length > 0 ? "needs-approval" : "succeeded",
          startedAt: timestamp,
          finishedAt: job.approvalGates.length > 0 ? undefined : timestamp,
          durationMs: job.approvalGates.length > 0 ? undefined : 1200,
          output:
            job.approvalGates.length > 0
              ? `Run paused at approval gates: ${job.approvalGates.join(", ")}.`
              : `Ran ${job.name} with ${job.allowedTools.length} allowed tools.`,
          auditEventIds: [eventId]
        };
        const event: BrainEvent = {
          id: eventId,
          tenantId,
          actorId: job.ownerId,
          action: "cron.run",
          targetId: run.id,
          targetType: "cron-run",
          policyDecision: run.status === "needs-approval" ? "needs-approval" : "allow",
          metadata: { cronJobId: job.id },
          createdAt: timestamp
        };

        await insertCronRun(tx, tenantId, run);
        await insertEvent(tx, event);
        return { job, run };
      });
    },

    async listCronRuns(id: string): Promise<CronRun[]> {
      const result = await client.query<Row>(
        `SELECT *
         FROM cron_runs
         WHERE tenant_id = $1 AND cron_job_id = $2
         ORDER BY started_at DESC`,
        [tenantId, id]
      );
      return result.rows.map(toCronRun);
    },

    async allRegistry(): Promise<RegistryItem[]> {
      const result = await client.query<Row>(`SELECT * FROM registry_items WHERE tenant_id = $1 ORDER BY updated_at DESC`, [tenantId]);
      return result.rows.map(toRegistryItem);
    },

    async allEvents(): Promise<BrainEvent[]> {
      const result = await client.query<Row>(`SELECT * FROM brain_events WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]);
      return result.rows.map(toEvent);
    }
  };
}
