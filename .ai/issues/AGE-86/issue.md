# AGE-86 Durable Scheduler Worker With Leases, Retries, Budgets

Linear: https://linear.app/agentiwise/issue/AGE-86/durable-scheduler-worker-with-leases-retries-budgets

## What To Build

Build the cron execution engine for self-hosted and cloud deployments. Cron jobs should persist definitions, lease due work without duplicate execution, enforce runtime/budget/retry policy, run through the same policy/tool gateway as interactive agents, and keep full run history.

## Acceptance Criteria

- Scheduler stores cron definitions, next run, timezone, owner, tier, allowed tools, budget, retries, timeout, and approval gates.
- Worker leasing prevents duplicate execution across multiple workers.
- Runs record queued, started, succeeded, failed, retried, canceled, and approval-paused states.
- Tool access goes through the governed invocation gateway.
- Load tests prove at least 1,000 scheduled jobs execute without duplicate runs.

## Blocked By

- AGE-83
