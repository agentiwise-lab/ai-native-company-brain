# Implementation Plan

## Slice

Add a file-backed production ops service with telemetry, health, backup/restore, migration recovery, Helm chart validation, API routes, dashboard visibility, and an operability runbook.

## Design

- Persist ops state in `data/operability-state.json` by default with env override.
- Model telemetry events for logs, metrics, and traces across app, workers, scheduler, Postgres, Redis/queue, object store, Composio, and MCP.
- Collect health from scheduler state, connector health, queue depth, worker heartbeats, database/object-store/Composio/MCP probes, and alert thresholds.
- Create backups as deterministic JSON snapshots with SHA-256 checksum and event-ledger count.
- Restore backups only when checksum and event-ledger verification pass.
- Record failed migrations with rollback steps, dry-run command, backup restore pointer, and connector checkpoint replay guidance.
- Add Helm chart files that support internal/external Postgres, internal/external Redis, object storage config, app, workers, scheduler, and secrets.
- Add API routes for status, health, backup, restore, and migration recovery.
- Add dashboard visibility for health, alerts, backups/restores, migration recovery, and telemetry.

## Boundaries

- Backup v1 stores portable app-state snapshots and integrity metadata. It does not run `pg_dump` or object-store copy commands directly from the web process.
