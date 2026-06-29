import { Pool } from "pg";
import {
  artifacts,
  atoms,
  changesets,
  cronRuns,
  edges,
  events,
  principals,
  qualityScores,
  registry
} from "../lib/seed";
import type { QualityScore, RegistryItem } from "../lib/types";

const tenantId = process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";
const dryRun = process.argv.includes("--dry-run");

const commonRegistryKeys = new Set([
  "id",
  "tenantId",
  "kind",
  "name",
  "slug",
  "description",
  "tier",
  "ownerId",
  "version",
  "status",
  "permissions",
  "dependencies",
  "requiredTools",
  "adapterTargets",
  "updatedAt"
]);

function registryManifest(item: RegistryItem) {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !commonRegistryKeys.has(key)));
}

function qualityDimensions(score: QualityScore) {
  return {
    evidenceStrength: score.evidenceStrength,
    freshness: score.freshness,
    specificity: score.specificity,
    actionability: score.actionability,
    conflictRisk: score.conflictRisk,
    reuse: score.reuse,
    reviewerTrust: score.reviewerTrust,
    retractionPenalty: score.retractionPenalty
  };
}

async function main() {
if (dryRun) {
  console.log(
    JSON.stringify(
      {
        tenantId,
        principals: principals.length,
        artifacts: artifacts.length,
        atoms: atoms.length,
        registryItems: registry.length,
        changesets: changesets.length,
        dependencyEdges: edges.length,
        cronRuns: cronRuns.length,
        qualityScores: qualityScores.length,
        brainEvents: events.length
      },
      null,
      2
    )
  );
  return;
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query("BEGIN");
  await pool.query(
    `INSERT INTO tenants (id, name, encryption_key_ref)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, encryption_key_ref = EXCLUDED.encryption_key_ref`,
    [tenantId, "Demo Company", "local-dev-key"]
  );

  for (const principal of principals) {
    await pool.query(
      `INSERT INTO principals (id, tenant_id, name, email, role, teams, tiers, scopes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         teams = EXCLUDED.teams,
         tiers = EXCLUDED.tiers,
         scopes = EXCLUDED.scopes`,
      [principal.id, tenantId, principal.name, principal.email, principal.role, principal.teams, principal.tiers, principal.scopes]
    );
  }

  for (const artifact of artifacts) {
    await pool.query(
      `INSERT INTO source_artifacts (id, tenant_id, source_type, title, uri, owner_id, tier, sensitivity, checksum, captured_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [
        artifact.id,
        tenantId,
        artifact.sourceType,
        artifact.title,
        artifact.uri,
        artifact.ownerId,
        artifact.tier,
        artifact.sensitivity,
        artifact.checksum,
        artifact.capturedAt
      ]
    );
  }

  for (const atom of atoms) {
    await pool.query(
      `INSERT INTO knowledge_atoms (
        id, tenant_id, title, body, atom_type, tier, owner_id, source_ids, acl, status, version,
        confidence, freshness, review_due_at, tags, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (id) DO NOTHING`,
      [
        atom.id,
        tenantId,
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

  for (const item of registry) {
    await pool.query(
      `INSERT INTO registry_items (
        id, tenant_id, kind, name, slug, description, tier, owner_id, version, status, permissions,
        dependencies, required_tools, adapter_targets, manifest, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16)
      ON CONFLICT (id) DO NOTHING`,
      [
        item.id,
        tenantId,
        item.kind,
        item.name,
        item.slug,
        item.description,
        item.tier,
        item.ownerId,
        item.version,
        item.status,
        item.permissions,
        item.dependencies,
        item.requiredTools,
        item.adapterTargets,
        JSON.stringify(registryManifest(item)),
        item.updatedAt
      ]
    );
  }

  for (const changeset of changesets) {
    await pool.query(
      `INSERT INTO changesets (
        id, tenant_id, title, target_type, target_id, tier, author_id, owner_id, reviewers,
        status, summary, checks, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
      ON CONFLICT (id) DO NOTHING`,
      [
        changeset.id,
        tenantId,
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

  for (const edge of edges) {
    await pool.query(
      `INSERT INTO dependency_edges (id, tenant_id, from_id, to_id, relation)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [edge.id, tenantId, edge.fromId, edge.toId, edge.relation]
    );
  }

  for (const run of cronRuns) {
    await pool.query(
      `INSERT INTO cron_runs (id, tenant_id, cron_job_id, status, started_at, finished_at, duration_ms, output, audit_event_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
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

  for (const score of qualityScores) {
    await pool.query(
      `INSERT INTO quality_scores (id, tenant_id, subject_id, subject_type, score, dimensions, notes)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (id) DO NOTHING`,
      [score.id, tenantId, score.subjectId, score.subjectType, score.score, JSON.stringify(qualityDimensions(score)), score.notes]
    );
  }

  for (const event of events) {
    await pool.query(
      `INSERT INTO brain_events (id, tenant_id, actor_id, action, target_id, target_type, policy_decision, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        tenantId,
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

  await pool.query("COMMIT");
  console.log(`Seeded ${tenantId} demo data.`);
} catch (error) {
  await pool.query("ROLLBACK");
  throw error;
} finally {
  await pool.end();
}
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
