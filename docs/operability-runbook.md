# Operability Runbook

## Backup And Restore

Use the ops API before risky upgrades, migrations, connector rewrites, or registry schema changes.

1. Create a backup:

```bash
curl -X POST http://localhost:3000/api/v1/ops/backup \
  -H 'content-type: application/json' \
  -d '{"principalId":"usr_admin","label":"pre-upgrade"}'
```

2. Store the returned `backupId` and checksum in the deployment change record.

3. Restore only after checking the returned checksum and event-ledger verification:

```bash
curl -X POST http://localhost:3000/api/v1/ops/restore \
  -H 'content-type: application/json' \
  -d '{"principalId":"usr_admin","backupId":"backup_..."}'
```

## Failed Migration Recovery

When a migration fails:

1. Stop app writes and scheduler workers.
2. Run `npm run db:migrate:dry-run` to confirm the expected migration state.
3. Create or locate a verified backup from before the migration.
4. Record the failure and recovery plan:

```bash
curl -X POST http://localhost:3000/api/v1/ops/migrations/recover \
  -H 'content-type: application/json' \
  -d '{
    "principalId":"usr_admin",
    "migrationId":"20260630_example",
    "failedStep":"alter table",
    "error":"statement timeout",
    "backupId":"backup_...",
    "connectorCheckpointIds":["slack:acct_123"]
  }'
```

5. Restore the verified backup if needed.
6. Re-run `npm run db:migrate:dry-run`, then `npm run db:migrate`.
7. Restart app, workers, and scheduler.

## Connector Checkpoint Replay

After restore or failed migration rollback, replay connector checkpoints that may have advanced during the failed window.

1. Inspect connector health:

```bash
curl http://localhost:3000/api/v1/connectors/health
```

2. Replay the affected connector object from the last healthy checkpoint:

```bash
curl -X POST http://localhost:3000/api/v1/connectors/replay \
  -H 'content-type: application/json' \
  -d '{"connector":"slack","connectedAccountId":"acct_123","sourceObjectId":"msg_456"}'
```

3. Re-run health checks and confirm queue depth is below the configured threshold:

```bash
curl -X POST http://localhost:3000/api/v1/ops/health \
  -H 'content-type: application/json' \
  -d '{"principalId":"usr_admin","queueDepth":0,"workers":[]}'
```

## Helm Deployment

The chart in `deploy/helm/company-brain` supports:

- App deployment and service.
- Worker deployment.
- Scheduler deployment.
- Internal Postgres or external `DATABASE_URL`.
- Internal Redis or external `REDIS_URL`.
- Object storage endpoint and S3-compatible secret keys.
- Existing Kubernetes secret or chart-created secret.
