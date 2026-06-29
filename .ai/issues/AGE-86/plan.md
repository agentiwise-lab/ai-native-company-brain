# Implementation Plan

## Slice

Add a durable scheduler engine that can run self-hosted/cloud cron workloads through a shared lease and policy path.

## Design

- Add a file-backed scheduler state containing jobs, leases, runs, and audit events.
- Store job definitions with schedule, timezone, owner, tier, allowed tools, budget, retry policy, max runtime, approval gates, next run, and enabled/paused state.
- Lease due jobs by worker id with expiring leases and queued run records; a second worker cannot lease the same due job while a lease is active.
- Execute leases by transitioning runs from queued to running to succeeded/failed/retried/needs-approval.
- Route allowed tools through the AGE-83 `toolInvocationGateway` contract.
- Enforce budget, approval gates, max attempts, and retry backoff.
- Add cancel support for run history completeness.
- Add API routes for listing/upserting jobs, leasing due work, executing leases, and reading scheduler status.
- Add dashboard visibility for durable jobs, leases, run states, and retries.

## Boundaries

- Use deterministic minute-based next-run calculation in v1; richer cron parsing can land later.
- Use file-backed state for self-host v1 and keep the service shape portable to Postgres leases.
