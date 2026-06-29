# Test Plan For AGE-64: Persist Brain Records In Postgres

## Acceptance Criteria Coverage

| Criterion | Test or verification |
| --- | --- |
| App reads and writes core brain records from Postgres instead of in-memory seed state. | Unit test builds Postgres repository with fake client and asserts `dashboard`/`queryBrain` read rows through SQL client; runtime factory selects Postgres when `DATABASE_URL` exists. |
| Migrations and seed/bootstrap commands initialize a fresh database. | Command existence and script unit shape; `npm run db:migrate -- --dry-run` should validate SQL file; `npm run db:seed -- --dry-run` should generate seed operations without connecting. |
| Mutations are tenant-scoped and transactional. | Fake client test asserts `BEGIN`, tenant-specific inserts, and `COMMIT`; failure path asserts `ROLLBACK` and no success result. |
| Reloading app preserves core data. | Adapter reads from SQL rows after writes in fake client; route/page now use repository boundary instead of seed arrays. |
| Automated tests cover tenant scoping, transaction rollback, and event-ledger writes. | `tests/postgres-repository.test.ts` covers all three directly. |

## TDD Notes

- First failing test: importing `createPostgresRepository` from `lib/postgres-repository` should fail because it does not exist.
- Expected failure: missing module.
- Implementation note: fake SQL client should be small and deterministic; do not require a live database for unit tests.

## Commands

```bash
npm test -- tests/postgres-repository.test.ts
npm run ci
```

