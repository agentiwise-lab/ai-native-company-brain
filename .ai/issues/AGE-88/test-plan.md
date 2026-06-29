# Test Plan

- `tests/brain-health-agent.test.ts`
  - Enables the weekly job with owner, tier, budget, output destination, and schedule.
  - Normal run identifies stale/low-quality/missing-owner/source-health/conflict findings and opens actionable changesets.
  - No-op run creates no changesets when inputs are healthy.
  - Approval gate pauses the run before changesets are opened.
  - Budget exhaustion fails the run.
  - Duplicate changeset prevention avoids reopening the same atom/action recommendation.
  - API route covers enable, run, and status.

## Required Verification

- `npm test -- tests/brain-health-agent.test.ts`
- `npm run ci`
