# Org-Wide Company Brain Onboarding Implementation Design

## Purpose

The next onboarding phase turns first-run setup into an org-wide mission control flow. The admin connects work tools, describes the company, reviews an AI-generated setup plan, approves the org map and access defaults, then lands in a scoped cockpit for company, department, team, exec-protected, or regulated brain control.

The product should feel controlled and inspectable. The system proposes a brain build; the admin approves before broad sync, access changes, or write-capable automation.

## Onboarding Flow

```text
Choose mode
  -> Describe company
  -> Connect tools
  -> Preview connections
  -> Review AI setup plan
  -> Approve first brain build
  -> Cockpit with scope switcher
```

Modes:

- `supabase-local`: local Supabase for realistic development.
- `supabase-cloud`: existing Supabase project supplied by the user.
- `demo`: seed-backed demo without connected tools.

Mission steps:

1. Capture company name, admin, departments, teams, people, goals, challenges, and sensitive areas.
2. Select enabled brain levels from the fixed tiers: `individual`, `team`, `department`, `company-main`, `exec-protected`, `regulated`.
3. Select connectors. Each connector must preflight before sync.
4. Generate proposals for org units, memberships, brain level configs, connector source mapping, default operators, and first sync tasks.
5. Require explicit approval before activation.
6. Land in a cockpit with scope filtering.

## State Model

Persist setup as a resumable state machine:

- `onboarding_profile`: mode, company description, goals, challenges, sensitive areas, selected connectors, selected brain levels, current step, and status.
- `org_units`: company, department, team, exec-protected, and regulated units with owner/reviewer metadata.
- `org_memberships`: principal-to-unit mappings with role and team aliases.
- `brain_level_configs`: enabled tiers, labels, owners, reviewers, allowed roles, sensitivity defaults, and activation blockers.
- `setup_tasks`: resumable tasks with status, retryable flag, error, and next action.
- `setup_recommendations`: AI-generated proposals that stay pending until approval.
- `connector_preflights`: per-connector account/scope/source/candidate preview and approval status.

Existing `SetupState` remains the first-run source of truth. The new state extends it rather than replacing it so current setup APIs keep working.

## Supabase Architecture

Supabase is the default managed substrate:

- Postgres stores tenants, principals, org units, memberships, brain levels, atoms, artifacts, registry packages, changesets, cron runs, and audit events.
- `vector` extension stores embeddings for hybrid retrieval.
- Supabase Storage stores raw source artifacts.
- RLS is enabled for tenant/org/tier defense in depth.
- App-side ACL checks remain required.
- Browser clients never receive service credentials; setup and preflight mutations happen server-side.

Preflight checks:

- `vector` extension available.
- Required tables/migrations present.
- RLS enabled for exposed tables.
- Storage bucket configured.
- No conflicting legacy tables or stale migrations.
- Data API exposure is not assumed for SQL-created tables.

References:

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/extensions/pgvector

## Connector Preflight

Every connector follows the same sequence:

```text
connect -> preflight -> source preview -> sample sync -> candidate preview -> approve full sync
```

Preflight must report:

- Account status: pending, active, revoked, errored.
- Missing scopes and exact remediation.
- Duplicate connected accounts.
- Readable sources and ignored sources.
- Inferred owner, team, brain tier, sensitivity, and risk.
- Recommended backfill range.
- Whether the source is too broad to sync without manual selection.

Restricted findings are quarantined into `exec-protected` or `regulated` proposals and never silently exposed to lower tiers.

## Core 12 AI Operators

The UI calls these AI operators. Internally they are canonical registry skill packages.

Published safe defaults:

1. `company-profile-builder`
2. `org-map-builder`
3. `brain-level-designer`
4. `connector-scope-planner`
5. `onboarding-brief`
6. `automation-opportunity-finder`

Review-gated defaults:

1. `access-policy-designer`
2. `department-brain-starter`
3. `team-brain-starter`
4. `candidate-memory-extractor`
5. `decision-log-maintainer`
6. `brain-health-operator`

Rule: operators that only read, summarize, recommend, or open proposals can be published. Operators that write memory, change ACLs, start broad syncs, invoke external tools, or create cron jobs must be review-gated.

## Access Levels

Roles:

- Admin: tenant setup, Supabase provisioning, skill install, connector config, approval.
- Reviewer: approve memory, registry, operator, and access changesets for assigned tiers.
- Operator: run approved connector syncs, scheduler jobs, and health checks.
- Employee: query accessible brains and submit candidate memory.
- Agent: query or act only through approved operators/tools within assigned tiers and teams.
- Auditor: `audit:read` scope for trace/export workflows.

Brain level defaults:

- Enabled: `individual`, `team`, `department`, `company-main`.
- Opt-in: `exec-protected`, `regulated`.
- Activation is blocked if any enabled level lacks owner or reviewer.

## Cockpit UX

After activation, the cockpit shows a scope switcher:

- Company
- Each department
- Each team
- Exec Protected
- Regulated

The selected scope filters sources, memory atoms, changesets, AI operators, automations, health, access posture, and audit events. The global company view remains available to admins.

## Edge Cases

- Setup is interrupted and resumed.
- Supabase project has conflicting tables, missing `vector`, disabled RLS, stale migrations, or API exposure mismatch.
- Connector grants too few scopes, is revoked, duplicates another account, maps to the wrong principal, or returns no useful content.
- Same person/team appears with different names across tools.
- Org-wide setup has only one department connected.
- Source permissions conflict with chosen brain level.
- First sync produces too many or too few candidates.
- AI-inferred org map is low confidence.
- Default operator depends on an unconnected tool.
- Multi-department users get union access only where tier, role, team, and membership allow it.
- User starts local and later migrates to Supabase cloud.

## Acceptance Criteria

- Fresh setup presents guided onboarding instead of a raw form.
- Setup can be resumed after interruption.
- Admin can review and approve generated setup proposals.
- Enabled brain levels require owners and reviewers.
- Connector preflight shows source previews before broad sync.
- Core 12 AI operators are installed with correct publish/review defaults.
- Cockpit scope switcher filters dashboard state.
- Supabase preflight summarizes vector, RLS, storage, migration, and conflict status.
