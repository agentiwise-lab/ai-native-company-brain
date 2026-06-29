# AGE-88 Weekly Brain Health Agent Opens Concrete Changesets

Linear: https://linear.app/agentiwise/issue/AGE-88/weekly-brain-health-agent-opens-concrete-changesets

## What To Build

Create the first self-maintenance agent: a weekly brain health job that inspects stale atoms, low-quality memory, unresolved conflicts, missing owners, source health, and repeated failed queries, then opens concrete review changesets instead of producing only a report.

## Acceptance Criteria

- Admin can enable a weekly brain health cron job with owner, tier, budget, and output destination.
- Job identifies stale atoms, low-quality atoms, missing owners, unresolved conflicts, and source health problems.
- Job opens actionable changesets for refresh, demotion, supersession, or owner assignment.
- Report links every recommendation to source data, affected atom, reviewer, and policy context.
- Tests cover normal run, no-op run, approval pause, budget exhaustion, and duplicate changeset prevention.

## Blocked By

- AGE-80
- AGE-86
