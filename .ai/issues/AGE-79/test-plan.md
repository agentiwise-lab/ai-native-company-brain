# Test Plan

- Unit: duplicate candidate opens a merge-duplicate review conflict with compared claims and source/tier/freshness metadata.
- Unit: contradiction candidate opens a contradiction conflict with reject/request-evidence recommendations.
- Unit: stale reviewed atom plus fresh candidate recommends superseding stale memory.
- Unit: reviewer can dismiss a false positive and the workflow records resolution/audit events.
- Unit: restricted or inaccessible existing atoms are not exposed to unauthorized reviewers, and hidden-match counts are recorded.
- API: conflict detection can run from extracted candidates/dashboard atoms and conflict resolution records reviewer action.

## Verification commands

- `npm test -- tests/memory-conflicts.test.ts`
- `npm test -- tests/memory-conflicts.test.ts tests/brain-api.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
