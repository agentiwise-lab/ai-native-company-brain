# AGE-63: Boot tenant with persisted admin setup

URL: https://linear.app/agentiwise/issue/AGE-63/boot-tenant-with-persisted-admin-setup
Project: AI-Native Company Brain
Milestone: Phase 1 - Self-Hosted Core
State: In Progress
Blocked by: None

## What to build

Create the first-run path that turns a fresh self-hosted deployment into a usable tenant. An operator should be able to open the app, create the initial tenant/admin, configure basic identity settings, enter required Composio environment status, and land in the operator console with persisted settings and audit events.

## Acceptance criteria

- [ ] Fresh deployment shows a setup flow instead of the seeded dashboard.
- [ ] Admin can create the tenant, first user, encryption/settings record, and initial brain tiers.
- [ ] Setup state persists across reloads and service restarts.
- [ ] Setup emits immutable audit events for tenant creation and admin bootstrap.
- [ ] Automated tests cover completed setup, incomplete setup, and duplicate bootstrap attempts.

## Blocked by

None - can start immediately.

