# Plan For AGE-64: Persist Brain Records In Postgres

## Goal

Move the repository boundary from direct seed arrays to a real persistence abstraction with a Postgres implementation. The app should use Postgres whenever `DATABASE_URL` is configured, while retaining an explicit seed fallback for local/demo runs without a database.

## Scope

- In scope:
  - Async repository contract for dashboard, query, commit, lineage, registry, cron, quality, and events.
  - Postgres adapter using the current `db/schema.sql`.
  - Migration and seed commands for a fresh database.
  - Transactional mutation path for brain commits with atom, changeset, and audit event consistency.
  - Route/MCP/page updates to await repository calls.
  - Automated tests using a fake SQL client to prove tenant scoping, rollback, and event writes without requiring a real Postgres service in unit tests.
- Out of scope:
  - Full production migration framework with version table and rollback migrations.
  - Complete pgvector embedding search. This issue keeps lexical filtering compatible with current app behavior.
  - Replacing setup file store from AGE-63. Setup moves to Postgres separately when auth/tenant bootstrapping matures.

## Implementation Decision

Add `pg` and implement a lightweight adapter over parameterized SQL. Use an exported factory so tests can inject a fake transactional client. Runtime selection:

- `DATABASE_URL` present and `COMPANY_BRAIN_REPOSITORY !== "seed"`: use Postgres.
- Otherwise: use seed repository for local no-DB development and current tests.

This preserves deployability for Docker Compose while keeping the local dev experience usable.

## Implementation Steps

1. Split the current seed-backed repository into an async seed repository implementation.
2. Define a `BrainRepository` interface and async exported `repository` facade.
3. Add Postgres adapter:
   - map rows to typed domain objects
   - tenant-scoped selects
   - transactional `commitBrain`
   - append `brain_events` for query, changeset open, cron run, publish/rollback where applicable
4. Add scripts:
   - `db:migrate`
   - `db:seed`
5. Update API routes, MCP handler, and home page to await repository calls.
6. Add tests:
   - repository selection
   - tenant-scoped reads
   - transaction rollback on failed commit
   - event-ledger writes
7. Run `npm run ci`.

## Files Expected To Change

- `package.json`
- `lib/repository.ts`
- `lib/postgres-repository.ts`
- `scripts/db-migrate.mjs`
- `scripts/db-seed.mjs`
- API routes under `app/api/v1`
- `lib/mcp.ts`
- `app/page.tsx`
- `tests/postgres-repository.test.ts`

## Risks And Open Questions

- The current schema stores registry-specific fields inside `manifest`; the adapter must hydrate typed registry variants from that JSON.
- A real Postgres integration test would require Docker in CI. For this issue, use fake client tests plus migration/seed scripts; a later issue can add containerized integration tests.

## Completion Evidence

- [ ] First persistence tests fail before implementation.
- [ ] `npm run ci` passes.
- [ ] Migration and seed commands exist and are documented.
- [ ] Branch pushed to GitHub.
- [ ] Linear `AGE-64` marked Done only after green push.

