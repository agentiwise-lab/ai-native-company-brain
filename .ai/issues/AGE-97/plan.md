# Implementation Plan

## Slice

Add a managed operations service for Composio-backed connector and scheduler workloads with per-tenant usage metering, plan-limit enforcement, support-safe diagnostics, worker recovery, and upgrade replay preservation.

## Design

- Persist managed ops state in `data/managed-ops-state.json` by default with env override.
- Record per-tenant usage events for connector syncs, Composio actions, tool invocations, storage bytes, queries, cron runs, and worker milliseconds.
- Aggregate usage into cost and plan-limit status with alerts before runaway connector or scheduler work.
- Enforce plan limits before new connector/cron usage is accepted.
- Provide sanitized support views that include health, queue depth, worker failures, usage, and alerts without secrets or restricted source content.
- Record failed worker recovery plans that release leases, restart workers, and replay preserved connector checkpoints.
- Plan managed upgrades that preserve connector checkpoints, cron schedules, package versions, and replay steps.
- Add API routes for usage, plan enforcement, support view, worker failure, and upgrade planning.
- Add dashboard visibility for usage, alerts, support diagnostics, and upgrades.

## Boundaries

- Managed ops v1 records control-plane decisions and support diagnostics. It does not execute actual cloud billing or worker restarts.
