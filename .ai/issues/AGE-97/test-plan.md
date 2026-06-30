# Test Plan

- `tests/managed-ops.test.ts`
  - Records usage by tenant for connector syncs, Composio actions, tool invocations, storage, queries, cron runs, and worker time.
  - Blocks plan-limit overflow before runaway connector/cron usage.
  - Produces tenant-isolated support diagnostics with secrets and restricted content redacted.
  - Records failed worker recovery with checkpoint replay and lease cleanup guidance.
  - Plans upgrade replay while preserving connector checkpoints, cron schedules, and package versions.
  - API routes cover usage, limit checks, support view, worker recovery, upgrade planning, and status.

## Required Verification

- `npm test -- tests/managed-ops.test.ts`
- `npm run ci`
