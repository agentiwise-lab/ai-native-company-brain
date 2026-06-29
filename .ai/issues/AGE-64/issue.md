# AGE-64: Persist brain artifacts, atoms, changesets, and events in Postgres

URL: https://linear.app/agentiwise/issue/AGE-64/persist-brain-artifacts-atoms-changesets-and-events-in-postgres
Project: AI-Native Company Brain
Milestone: Phase 1 - Self-Hosted Core
State: In Progress
Blocked by: AGE-63

## What to build

Replace seed-backed state with a real tenant-scoped persistence path for source artifacts, knowledge atoms, changesets, registry items, cron definitions, quality scores, and append-only brain events. Every read/write used by the operator console and APIs should go through the same repository boundary.

## Acceptance criteria

- [ ] App reads and writes core brain records from Postgres instead of in-memory seed state.
- [ ] Migrations and seed/bootstrap commands can initialize a fresh database.
- [ ] Mutations are tenant-scoped and wrapped in transactions where state and audit must stay consistent.
- [ ] Reloading the app preserves artifacts, atoms, changesets, registry items, cron jobs, and events.
- [ ] Automated tests cover tenant scoping, transaction rollback, and event-ledger writes.

## Blocked by

- AGE-63

