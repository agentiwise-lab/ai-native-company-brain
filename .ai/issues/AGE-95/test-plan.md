# Test Plan

- `tests/operability.test.ts`
  - Records logs, metrics, and traces for core surfaces.
  - Collects worker health and raises queue-depth alerts.
  - Creates a backup and restores it with checksum and event-ledger verification.
  - Rejects restore when checksum does not match.
  - Records failed migration rollback/recovery with connector checkpoint replay guidance.
  - Validates the Helm chart supports app, workers, scheduler, Postgres/external Postgres, Redis/external Redis, object storage, and secrets.
  - API routes cover health, backup, restore, migration recovery, and status.

## Required Verification

- `npm test -- tests/operability.test.ts`
- `npm run ci`
