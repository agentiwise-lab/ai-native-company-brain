import { Pool, type PoolClient } from "pg";
import { canDiscoverRegistryItem, canReadAtom, enforceChangesetMerge } from "./policy";
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
  RegistryPublishResult,
  RegistryRollbackResult
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
    atomType: "claim",
    tier: input.tier ?? "team",
    ownerId: principal.id,
    sourceIds: input.sourceIds ?? [],
    acl: {
      teams: principal.teams,
      roles: ["admin", "reviewer", "operator", "agent"],
      sensitivity: "internal"
    },
    status: "candidate",
    version: 1,
    confidence: 0.62,
    freshness: 1,
    reviewDueAt: new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now,
    updatedAt: now,
    tags: input.sourceUri ? ["candidate", "agent-commit", "source-linked"] : ["candidate", "agent-commit"]
  };
}

function createAtomChangeset(atom: KnowledgeAtom, principal: Principal, now: string, id: (prefix: string) => string): Changeset {
  return {
    id: id("cs"),
    tenantId: atom.tenantId,
    title: `Promote ${atom.title}`,
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
      const readable = atomResult.rows
        .map(toAtom)
        .map((atom) => ({ atom, policy: canReadAtom(principal, atom) }))
        .filter(({ policy }) => policy.allowed)
        .map(({ atom }) => atom);
      const matches = readable.filter((atom) => {
        if (!query.trim()) {
          return true;
        }
        return includesText(atom.title, query) || includesText(atom.body, query) || atom.tags.some((tag) => includesText(tag, query));
      });
      const citations = query.trim() ? matches : readable.slice(0, 3);
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
            citations: citations.map((atom) => atom.id)
          }
        },
        tenantId,
        now(),
        id
      );
      await insertEvent(client, event);

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

    async commitBrain(input: CommitBrainInput) {
      return transaction(async (tx) => {
        const principal = await selectPrincipal(tx, input.principalId);
        const timestamp = now();
        const atom = createCandidateAtom(input, principal, tenantId, timestamp, id);
        const changeset = createAtomChangeset(atom, principal, timestamp, id);
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
              sourceTitle: input.sourceTitle
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
