# Test Plan

- `tests/durable-scheduler.test.ts`
  - Stores cron definitions with next run, timezone, owner, tier, allowed tools, budget, retry, timeout, and approval gates.
  - Prevents duplicate leasing across workers.
  - Executes allowed tools through the tool invocation gateway.
  - Records queued, running, succeeded, failed, retried, canceled, and approval-paused states.
  - Load test leases 1,000 due jobs without duplicate run ids.
  - API routes cover job upsert, lease, execute, and status.

## Required Verification

- `npm test -- tests/durable-scheduler.test.ts`
- `npm test`
- `npm run build`
