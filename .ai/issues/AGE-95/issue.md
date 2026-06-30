# AGE-95 Observability, backup/restore, and Helm deployment

## What to build

Make the self-host deployment production-operable. The system should expose logs, metrics, traces, health checks, queue/scheduler visibility, backup/restore workflows, migration recovery, and a Helm/Kubernetes deployment path that preserves the same OSS core behavior.

## Acceptance criteria

- [ ] App, workers, scheduler, database, object store, queue, Composio calls, and MCP surface emit useful logs/metrics/traces.
- [ ] Admin can run backup and restore with integrity checks and event-ledger verification.
- [ ] Failed migration recovery and connector checkpoint replay are documented and tested.
- [ ] Helm chart supports app, workers, scheduler, Postgres/external Postgres, Redis/external Redis, object storage, and secrets.
- [ ] Tests cover backup restore, failed migration rollback, worker health, queue depth alert, and Helm template validation.

## Blocked by

- AGE-64
- AGE-86
