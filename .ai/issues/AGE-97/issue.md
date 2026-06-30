# AGE-97 Managed Composio connector and scheduler operations with usage metering

## What to build

Operate Composio-backed connectors and scheduler workers as a managed cloud service. Cloud admins should see connector/scheduler health, queue depth, usage, costs, plan limits, alerts, support diagnostics, and upgrade-safe operations while preserving the same policy/audit model as self-host.

## Acceptance criteria

- [ ] Managed cloud tracks connector sync volume, Composio action/tool usage, storage, query volume, cron runs, and worker time by tenant.
- [ ] Plan limits and budget alerts are enforced before runaway connector or cron usage.
- [ ] Support/admin tooling can inspect health without exposing tenant secrets or restricted source content.
- [ ] Managed upgrades preserve connector checkpoints, cron schedules, and package versions.
- [ ] Tests cover usage metering, plan limit block, tenant-isolated support view, failed worker recovery, and upgrade replay.

## Blocked by

- AGE-96
- AGE-75
- AGE-86
