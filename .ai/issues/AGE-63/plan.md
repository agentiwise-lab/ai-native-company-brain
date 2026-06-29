# Plan For AGE-63: Boot Tenant With Persisted Admin Setup

## Goal

Replace the unconditional seeded dashboard with a first-run tenant bootstrap path. A fresh self-hosted app should show setup, accept tenant/admin/Composio configuration, persist it locally for this Phase 1 slice, emit audit events, and then show the existing operator console on later loads.

## Scope

- In scope:
  - A setup domain model and file-backed setup store.
  - API endpoints for setup state and bootstrap.
  - First-run UI on `/` when setup is incomplete.
  - Durable audit events for tenant creation and admin bootstrap.
  - Tests for incomplete setup, completed setup, duplicate bootstrap, validation, and persistence.
- Out of scope:
  - Full Postgres repository migration. That is AGE-64.
  - Production SSO/SAML/SCIM.
  - Real Composio API validation. This issue captures config/status only.

## Implementation Decision

Use a small file-backed setup store as the first persisted vertical slice. Default path should be `data/setup-state.json`, with `COMPANY_BRAIN_SETUP_PATH` allowing tests and deployments to override it. The `data` directory is already gitignored. AGE-64 can move the same domain/API contract to Postgres without changing the first-run UI contract.

## Implementation Steps

1. Add setup types and store functions:
   - `getSetupState`
   - `bootstrapTenant`
   - duplicate bootstrap guard
   - audit event creation
2. Add API route:
   - `GET /api/v1/setup`
   - `POST /api/v1/setup`
3. Update `/` server page:
   - if setup incomplete, show setup form
   - if setup complete, show existing dashboard
4. Add setup form action or API-backed form path.
5. Add tests for store behavior and page branch behavior where practical.
6. Run `npm run ci`.

## Files Expected To Change

- `lib/setup.ts`
- `app/api/v1/setup/route.ts`
- `app/page.tsx`
- `tests/setup.test.ts`
- `.ai/issues/AGE-63/*`

## Risks And Open Questions

- File persistence is intentionally temporary. The API/domain shape should be narrow so AGE-64 can replace storage with Postgres.
- Next server actions may complicate testability. Prefer store/API tests for durable behavior and keep UI branch simple.

## Completion Evidence

- [ ] `npm run ci` passes.
- [ ] Fresh state returns incomplete setup.
- [ ] Bootstrap creates tenant/admin/settings/tiers/audit events.
- [ ] Re-read state proves persistence.
- [ ] Duplicate bootstrap is rejected.
- [ ] Branch pushed to GitHub.
- [ ] Linear marked Done only after push.

