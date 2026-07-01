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

CREATE TABLE IF NOT EXISTS onboarding_profiles (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('supabase-local', 'supabase-cloud', 'demo')),
  status TEXT NOT NULL CHECK (status IN ('not-started', 'draft', 'plan-ready', 'active', 'blocked')),
  current_step TEXT NOT NULL CHECK (current_step IN ('mode', 'describe', 'connect', 'preview', 'review', 'activate')),
  company_description TEXT NOT NULL DEFAULT '',
  goals TEXT[] NOT NULL DEFAULT '{}',
  challenges TEXT[] NOT NULL DEFAULT '{}',
  sensitive_areas TEXT[] NOT NULL DEFAULT '{}',
  selected_connectors TEXT[] NOT NULL DEFAULT '{}',
  selected_brain_tiers brain_tier[] NOT NULL DEFAULT '{}',
  supabase_project_ref TEXT,
  supabase_project_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_units (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('company', 'department', 'team', 'exec-protected', 'regulated')),
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES org_units(id) ON DELETE SET NULL,
  owner_id TEXT NOT NULL REFERENCES principals(id),
  reviewer_ids TEXT[] NOT NULL DEFAULT '{}',
  tier brain_tier NOT NULL,
  confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK (source IN ('user', 'inferred', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_units_tenant_kind_idx ON org_units (tenant_id, kind, tier);
CREATE INDEX IF NOT EXISTS org_units_parent_idx ON org_units (tenant_id, parent_id);

CREATE TABLE IF NOT EXISTS org_memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'reviewer', 'operator', 'employee', 'agent')),
  team_aliases TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL CHECK (source IN ('setup', 'connector', 'scim')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, principal_id, unit_id)
);

CREATE INDEX IF NOT EXISTS org_memberships_principal_idx ON org_memberships (tenant_id, principal_id, role);
CREATE INDEX IF NOT EXISTS org_memberships_unit_idx ON org_memberships (tenant_id, unit_id);

CREATE TABLE IF NOT EXISTS brain_level_configs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tier brain_tier NOT NULL,
  label TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  owner_id TEXT REFERENCES principals(id),
  reviewer_ids TEXT[] NOT NULL DEFAULT '{}',
  allowed_roles TEXT[] NOT NULL DEFAULT '{}',
  default_sensitivity sensitivity NOT NULL DEFAULT 'internal',
  activation_blockers TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, tier)
);

CREATE TABLE IF NOT EXISTS setup_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'blocked')),
  retryable BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  next_action TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS setup_tasks_status_idx ON setup_tasks (tenant_id, status);

CREATE TABLE IF NOT EXISTS setup_recommendations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('org-map', 'access-policy', 'default-operators', 'connector-plan', 'supabase-preflight')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
  affected_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS setup_recommendations_status_idx ON setup_recommendations (tenant_id, status, risk);

CREATE TABLE IF NOT EXISTS connector_preflights (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('not-configured', 'needs-scope', 'ready', 'blocked')),
  account_status TEXT NOT NULL CHECK (account_status IN ('pending', 'active', 'revoked', 'missing')),
  required_scopes TEXT[] NOT NULL DEFAULT '{}',
  missing_scopes TEXT[] NOT NULL DEFAULT '{}',
  source_previews JSONB NOT NULL DEFAULT '[]',
  sample_candidate_count INTEGER NOT NULL DEFAULT 0,
  approval_status TEXT NOT NULL CHECK (approval_status IN ('pending', 'approved', 'blocked')),
  next_action TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, connector)
);

CREATE TABLE IF NOT EXISTS supabase_preflight_checks (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  check_id TEXT NOT NULL CHECK (check_id IN ('project', 'vector', 'rls', 'storage', 'migrations', 'conflicts', 'data-api')),
  mode TEXT NOT NULL CHECK (mode IN ('supabase-local', 'supabase-cloud', 'demo')),
  project_ref TEXT,
  project_url TEXT,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'warning', 'failed', 'skipped')),
  detail TEXT NOT NULL,
  ready BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, check_id)
);

CREATE TABLE IF NOT EXISTS setup_audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES principals(id),
  target_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS setup_audit_events_target_idx ON setup_audit_events (tenant_id, target_id, created_at DESC);

COMMENT ON TABLE onboarding_profiles IS 'Resumable org-wide Company Brain onboarding profile.';
COMMENT ON TABLE connector_preflights IS 'Safe connector workflow: preflight, source preview, sample sync, candidate preview, full-sync approval.';
COMMENT ON COLUMN source_artifacts.raw_object_key IS 'Supabase Storage object key for raw artifacts, normally under company-brain-artifacts/<tenant_id>/...';

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('company-brain-artifacts', 'company-brain-artifacts', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenants',
    'principals',
    'source_artifacts',
    'knowledge_atoms',
    'registry_items',
    'changesets',
    'dependency_edges',
    'cron_runs',
    'quality_scores',
    'brain_events',
    'onboarding_profiles',
    'org_units',
    'org_memberships',
    'brain_level_configs',
    'setup_tasks',
    'setup_recommendations',
    'connector_preflights',
    'supabase_preflight_checks',
    'setup_audit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

DO $$
DECLARE
  target_table_name TEXT;
  target_policy_name TEXT;
BEGIN
  FOREACH target_table_name IN ARRAY ARRAY[
    'principals',
    'source_artifacts',
    'knowledge_atoms',
    'registry_items',
    'changesets',
    'dependency_edges',
    'cron_runs',
    'quality_scores',
    'brain_events',
    'onboarding_profiles',
    'org_units',
    'org_memberships',
    'brain_level_configs',
    'setup_tasks',
    'setup_recommendations',
    'connector_preflights',
    'supabase_preflight_checks',
    'setup_audit_events'
  ] LOOP
    target_policy_name := 'tenant_isolation_' || target_table_name;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE pg_policies.schemaname = 'public'
        AND pg_policies.tablename = target_table_name
        AND pg_policies.policyname = target_policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO PUBLIC USING (tenant_id = nullif(current_setting(''app.current_tenant_id'', true), '''')) WITH CHECK (tenant_id = nullif(current_setting(''app.current_tenant_id'', true), ''''))',
        target_policy_name,
        target_table_name
      );
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tenants'
      AND policyname = 'tenant_isolation_tenants'
  ) THEN
    CREATE POLICY tenant_isolation_tenants
      ON tenants
      FOR ALL
      TO PUBLIC
      USING (id = nullif(current_setting('app.current_tenant_id', true), ''))
      WITH CHECK (id = nullif(current_setting('app.current_tenant_id', true), ''));
  END IF;
END $$;

INSERT INTO tenants (id, name, encryption_key_ref)
VALUES ('tenant_demo', 'Demo Company', 'local-dev-key')
ON CONFLICT (id) DO NOTHING;
