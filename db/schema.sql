CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  CREATE TYPE brain_tier AS ENUM (
    'individual',
    'team',
    'department',
    'company-main',
    'exec-protected',
    'regulated'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE registry_kind AS ENUM (
    'tool',
    'skill',
    'plugin',
    'cronjob',
    'agent',
    'policy'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE sensitivity AS ENUM (
    'public',
    'internal',
    'confidential',
    'restricted'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  encryption_key_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS principals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'reviewer', 'operator', 'employee', 'agent')),
  teams TEXT[] NOT NULL DEFAULT '{}',
  tiers brain_tier[] NOT NULL DEFAULT '{}',
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_artifacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  uri TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES principals(id),
  tier brain_tier NOT NULL,
  sensitivity sensitivity NOT NULL DEFAULT 'internal',
  checksum TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  raw_object_key TEXT,
  UNIQUE (tenant_id, checksum)
);

CREATE TABLE IF NOT EXISTS knowledge_atoms (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  atom_type TEXT NOT NULL,
  tier brain_tier NOT NULL,
  owner_id TEXT NOT NULL REFERENCES principals(id),
  source_ids TEXT[] NOT NULL DEFAULT '{}',
  acl JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('candidate', 'approved', 'stale', 'superseded', 'rejected')),
  version INTEGER NOT NULL DEFAULT 1,
  confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
  freshness NUMERIC(5, 4) NOT NULL DEFAULT 0,
  review_due_at TIMESTAMPTZ NOT NULL,
  embedding vector(1536),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) STORED,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_atoms_search_idx ON knowledge_atoms USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS knowledge_atoms_embedding_idx ON knowledge_atoms USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS knowledge_atoms_tier_status_idx ON knowledge_atoms (tenant_id, tier, status);

CREATE TABLE IF NOT EXISTS registry_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind registry_kind NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL,
  tier brain_tier NOT NULL,
  owner_id TEXT NOT NULL REFERENCES principals(id),
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'approved', 'published', 'deprecated', 'blocked')),
  permissions TEXT[] NOT NULL DEFAULT '{}',
  dependencies TEXT[] NOT NULL DEFAULT '{}',
  required_tools TEXT[] NOT NULL DEFAULT '{}',
  adapter_targets TEXT[] NOT NULL DEFAULT '{}',
  manifest JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug, version)
);

CREATE INDEX IF NOT EXISTS registry_items_kind_tier_idx ON registry_items (tenant_id, kind, tier, status);

CREATE TABLE IF NOT EXISTS changesets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  tier brain_tier NOT NULL,
  author_id TEXT NOT NULL REFERENCES principals(id),
  owner_id TEXT NOT NULL REFERENCES principals(id),
  reviewers TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('draft', 'checks-running', 'blocked', 'review', 'approved', 'merged', 'rolled-back')),
  summary TEXT NOT NULL,
  checks JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS changesets_target_idx ON changesets (tenant_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS changesets_status_idx ON changesets (tenant_id, status, tier);

CREATE TABLE IF NOT EXISTS dependency_edges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dependency_edges_from_idx ON dependency_edges (tenant_id, from_id, relation);
CREATE INDEX IF NOT EXISTS dependency_edges_to_idx ON dependency_edges (tenant_id, to_id, relation);

CREATE TABLE IF NOT EXISTS cron_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cron_job_id TEXT NOT NULL REFERENCES registry_items(id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'needs-approval')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  output TEXT NOT NULL DEFAULT '',
  audit_event_ids TEXT[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS cron_runs_job_idx ON cron_runs (tenant_id, cron_job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS quality_scores (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  dimensions JSONB NOT NULL DEFAULT '{}',
  notes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quality_scores_subject_idx ON quality_scores (tenant_id, subject_type, subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS brain_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES principals(id),
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  policy_decision TEXT NOT NULL CHECK (policy_decision IN ('allow', 'deny', 'needs-approval')),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brain_events_target_idx ON brain_events (tenant_id, target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brain_events_actor_idx ON brain_events (tenant_id, actor_id, created_at DESC);

INSERT INTO tenants (id, name, encryption_key_ref)
VALUES ('tenant_demo', 'Demo Company', 'local-dev-key')
ON CONFLICT (id) DO NOTHING;
